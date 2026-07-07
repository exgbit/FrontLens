import type { FrontLensConfig, RequirementCoverageResult, TestDataAssessmentResult, TestDataFinding, TestDataOperationConfig } from '../types.js';
import { ensureDir, writeJson, writeText } from '../utils/fs.js';
import { markdownEscape } from '../utils/text.js';
import path from 'node:path';

const destructivePattern = /创建|新增|编辑|删除|上传|提交|保存|导入|create|edit|delete|upload|submit|save|import|mutation/i;

function isDestructiveOperation(operation: TestDataOperationConfig): boolean {
  const method = operation.method?.toUpperCase();
  return Boolean(operation.destructive || (method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) || destructivePattern.test(`${operation.title} ${operation.command ?? ''} ${operation.endpoint ?? ''}`));
}

function destructiveRequirementCount(requirementCoverage?: RequirementCoverageResult): number {
  return (requirementCoverage?.items ?? []).filter((item) => destructivePattern.test(`${item.title} ${item.description ?? ''}`)).length;
}

function statusFromFindings(findings: TestDataFinding[]): TestDataAssessmentResult['status'] {
  if (findings.some((item) => item.severity === 'critical')) return 'failed';
  if (findings.some((item) => item.severity === 'high' || item.severity === 'medium')) return 'warning';
  return 'passed';
}

function recommendations(result: TestDataAssessmentResult): string[] {
  const items: string[] = [];
  if (result.status === 'skipped') items.push('Enable testData and provide records/setupSteps/cleanupSteps for release-grade business validation.');
  if (result.summary.destructiveRequirementCount === 0 && result.summary.destructiveOperationCount === 0 && result.summary.recordCount === 0) items.push('No mutating/data-dependent requirement was detected; no test data plan is required for this read-only scan.');
  if (result.summary.destructiveRequirementCount > 0 && result.summary.recordCount === 0) items.push('Destructive or data-dependent requirements need isolated test records and reset/cleanup instructions.');
  if (result.summary.missingCleanupCount > 0) items.push('Add cleanupSteps or per-record cleanupOperationId for generated/seeded data before enabling mutating journeys.');
  if (result.summary.productionRiskCount > 0) items.push('Do not run setup/mutating data operations in production unless allowProductionWrites is explicitly approved.');
  if (result.summary.sensitiveRecordCount > 0) items.push('Use synthetic/redacted sensitive fixtures and avoid copying production secrets into reports.');
  if (items.length === 0) items.push('Test data plan is reviewable. Keep fixture ids stable and rerun after any setup/cleanup change.');
  return [...new Set(items)];
}

export function buildTestDataAssessment(config: FrontLensConfig, requirementCoverage?: RequirementCoverageResult): TestDataAssessmentResult {
  const testData = config.testData;
  if (!testData.enabled) {
    return {
      enabled: false,
      status: 'skipped',
      checkedAt: new Date().toISOString(),
      environment: testData.environment,
      summary: {
        recordCount: 0,
        setupStepCount: 0,
        cleanupStepCount: 0,
        generatedRecordCount: 0,
        destructiveRequirementCount: 0,
        destructiveOperationCount: 0,
        missingCleanupCount: 0,
        sensitiveRecordCount: 0,
        productionRiskCount: 0
      },
      findings: [],
      recommendations: ['testData disabled; destructive/data-dependent business validation remains partial.']
    };
  }

  const destructiveRequirements = destructiveRequirementCount(requirementCoverage);
  const destructiveOperations = testData.setupSteps.filter(isDestructiveOperation);
  const generatedRecords = testData.records.filter((record) => record.state === 'generated' || record.state === 'seeded' || record.state === 'unknown');
  const cleanupIds = new Set(testData.cleanupSteps.map((step) => step.id));
  const findings: TestDataFinding[] = [];

  if (testData.records.length === 0 && destructiveRequirements > 0) {
    findings.push({
      id: 'TD-001',
      severity: 'high',
      category: 'missing-data',
      message: `${destructiveRequirements} destructive/data-changing requirement(s) exist but no isolated test records are declared.`
    });
  }

  for (const record of generatedRecords) {
    if (!record.cleanupOperationId && testData.cleanupSteps.length === 0) {
      findings.push({
        id: `TD-CLEANUP-${record.id}`,
        severity: 'high',
        category: 'missing-cleanup',
        recordId: record.id,
        message: `Generated/seeded record ${record.id} has no cleanupOperationId and no global cleanupSteps.`
      });
    } else if (record.cleanupOperationId && !cleanupIds.has(record.cleanupOperationId)) {
      findings.push({
        id: `TD-CLEANUP-MISSING-${record.id}`,
        severity: 'medium',
        category: 'missing-cleanup',
        recordId: record.id,
        operationId: record.cleanupOperationId,
        message: `Record ${record.id} references cleanup operation ${record.cleanupOperationId}, but that cleanup step is not declared.`
      });
    }
  }

  for (const operation of destructiveOperations) {
    const hasRollback = Boolean(operation.rollbackOperationId && testData.cleanupSteps.some((step) => step.id === operation.rollbackOperationId));
    if (!hasRollback && testData.cleanupSteps.length === 0) {
      findings.push({
        id: `TD-ROLLBACK-${operation.id}`,
        severity: 'high',
        category: 'missing-cleanup',
        operationId: operation.id,
        message: `Destructive setup operation ${operation.id} has no rollbackOperationId and no cleanupSteps.`
      });
    }
  }

  if (testData.environment === 'production' && (destructiveOperations.length > 0 || config.safety.allowCreate || config.safety.allowEdit || config.safety.allowDelete || config.safety.allowSubmit || config.safety.allowUpload) && !testData.allowProductionWrites) {
    findings.push({
      id: 'TD-PROD-WRITE',
      severity: 'critical',
      category: 'production-risk',
      message: 'Test data plan targets production with mutating operations/safety permissions but allowProductionWrites is false.'
    });
  }

  for (const record of testData.records.filter((record) => record.sensitive)) {
    findings.push({
      id: `TD-SENSITIVE-${record.id}`,
      severity: 'medium',
      category: 'sensitive-data',
      recordId: record.id,
      message: `Record ${record.id} is marked sensitive; use synthetic/redacted data and avoid leaking values into artifacts.`
    });
  }

  if (testData.records.length === 0 && testData.setupSteps.length === 0 && testData.cleanupSteps.length === 0 && destructiveRequirements > 0) {
    findings.push({
      id: 'TD-EMPTY-PLAN',
      severity: 'high',
      category: 'review',
      message: 'testData is enabled but no records, setupSteps, or cleanupSteps are declared.'
    });
  }

  const result: TestDataAssessmentResult = {
    enabled: true,
    status: 'passed',
    checkedAt: new Date().toISOString(),
    environment: testData.environment,
    summary: {
      recordCount: testData.records.length,
      setupStepCount: testData.setupSteps.length,
      cleanupStepCount: testData.cleanupSteps.length,
      generatedRecordCount: generatedRecords.length,
      destructiveRequirementCount: destructiveRequirements,
      destructiveOperationCount: destructiveOperations.length,
      missingCleanupCount: findings.filter((item) => item.category === 'missing-cleanup').length,
      sensitiveRecordCount: testData.records.filter((record) => record.sensitive).length,
      productionRiskCount: findings.filter((item) => item.category === 'production-risk').length
    },
    findings,
    recommendations: []
  };
  result.status = statusFromFindings(findings);
  result.recommendations = recommendations(result);
  return result;
}

function markdown(result: TestDataAssessmentResult): string {
  const rows = result.findings.map((finding) => `| ${finding.id} | ${finding.severity} | ${finding.category} | ${markdownEscape(finding.recordId ?? '-')} | ${markdownEscape(finding.operationId ?? '-')} | ${markdownEscape(finding.message)} |`);
  return `# FrontLens Test Data Assessment\n\n- Status: ${result.status}\n- Environment: ${result.environment}\n- Records / setup / cleanup: ${result.summary.recordCount} / ${result.summary.setupStepCount} / ${result.summary.cleanupStepCount}\n- Destructive requirements / operations: ${result.summary.destructiveRequirementCount} / ${result.summary.destructiveOperationCount}\n- Missing cleanup: ${result.summary.missingCleanupCount}\n- Sensitive records: ${result.summary.sensitiveRecordCount}\n- Production risks: ${result.summary.productionRiskCount}\n\n## Findings\n\n${rows.length ? ['| ID | Severity | Category | Record | Operation | Message |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No findings.'}\n\n## Recommendations\n\n${result.recommendations.map((item) => `- ${markdownEscape(item)}`).join('\n')}\n`;
}

export async function writeTestDataAssessment(result: TestDataAssessmentResult, outputDir: string): Promise<{ json: string; markdown: string }> {
  await ensureDir(outputDir);
  const json = path.join(outputDir, 'test-data-assessment.json');
  const md = path.join(outputDir, 'test-data-assessment.md');
  await writeJson(json, result);
  await writeText(md, markdown(result));
  return { json, markdown: md };
}
