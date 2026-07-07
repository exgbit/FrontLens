import type { PageModel, PageProfileAssessment, PermissionCheckResult, RequirementCoverageResult } from '../types.js';

export interface RoleMatrixNeed {
  needed: boolean;
  priority: 'P1' | 'P2' | 'P3';
  signals: string[];
  actionLabels: string[];
  permissionCheckIds: string[];
}

const ROLE_SENSITIVE_ACTION = /删除|移除|禁用|停用|启用|作废|清空|重置密码|保存|提交|创建|新增|编辑|授权|审批|发布|导出|下载|上传|delete|remove|disable|enable|destroy|clear|reset password|save|submit|create|add|edit|authorize|approve|publish|export|download|upload/i;
const DESTRUCTIVE_ACTION = /删除|移除|禁用|停用|作废|清空|重置密码|delete|remove|disable|destroy|clear|reset password/i;
const PRIVILEGED_ACTION = /删除|移除|禁用|停用|启用|作废|清空|重置密码|授权|审批|发布|delete|remove|disable|enable|destroy|clear|reset password|authorize|approve|publish/i;
const ROLE_REQUIREMENT = /角色|权限|授权|管理员|只读|无权限|未授权|禁止访问|role|permission|auth|authorize|admin|readonly|viewer|forbidden|unauthorized/i;

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function buttonLabel(button: PageModel['buttons'][number]): string {
  return `${button.label ?? ''} ${button.text ?? ''}`.trim();
}

export function buildRoleMatrixNeed(input: {
  pageModel: PageModel;
  permissionChecks: PermissionCheckResult[];
  pageProfile: PageProfileAssessment;
  requirementCoverage: RequirementCoverageResult;
}): RoleMatrixNeed {
  const actionLabels = unique(input.pageModel.buttons
    .filter((button) => button.visible && ROLE_SENSITIVE_ACTION.test(buttonLabel(button)))
    .map((button) => buttonLabel(button) || button.id)
  ).slice(0, 8);
  const destructiveLabels = actionLabels.filter((label) => DESTRUCTIVE_ACTION.test(label));
  const privilegedLabels = actionLabels.filter((label) => PRIVILEGED_ACTION.test(label));
  const permissionFindings = input.permissionChecks.filter((check) =>
    check.status !== 'passed' && (check.rule === 'api-auth' || check.rule === 'visible-danger' || check.rule === 'page-permission')
  );
  const permissionCheckIds = permissionFindings.map((check) => check.id);
  const roleRequirementCount = input.requirementCoverage.items.filter((item) =>
    ROLE_REQUIREMENT.test(`${item.title} ${item.description ?? ''} ${item.gaps.join(' ')}`)
  ).length;
  const credentialOrSecurityPage = input.pageProfile.pageType === 'credential-security';
  const highRiskActionPage = ['admin-data-list', 'form-flow', 'detail-master'].includes(input.pageProfile.pageType) && privilegedLabels.length > 0;
  const needed = permissionFindings.length > 0 || roleRequirementCount > 0 || credentialOrSecurityPage || highRiskActionPage;
  const priority: RoleMatrixNeed['priority'] =
    permissionFindings.some((check) => check.severity === 'critical' || check.severity === 'high' || check.status === 'failed') || destructiveLabels.length > 0 || roleRequirementCount > 0
      ? 'P1'
      : needed
        ? 'P2'
        : 'P3';

  const signals = unique([
    permissionFindings.length ? `permissionChecks need review: ${permissionCheckIds.join(', ')}` : '',
    roleRequirementCount > 0 ? `${roleRequirementCount} requirement(s) mention role/auth/permission scope.` : '',
    credentialOrSecurityPage ? 'pageProfile=credential-security; secrets/permission-sensitive actions need role coverage.' : '',
    highRiskActionPage ? `privileged/dangerous action buttons detected: ${privilegedLabels.join(', ')}` : '',
    destructiveLabels.length ? `destructive actions detected: ${destructiveLabels.join(', ')}` : ''
  ]);

  return {
    needed,
    priority,
    signals,
    actionLabels,
    permissionCheckIds
  };
}
