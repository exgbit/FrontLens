import type { DefectProofItem, DefectProofResult, Issue, IssueDispositionResult, RootCauseGroup } from '../types.js';

export function isProofReadyStatus(status: DefectProofItem['status']): boolean {
  return status === 'proven' || status === 'probable';
}

export function proofItemForGroup(defectProof: DefectProofResult | undefined, rootCauseGroupId: string | undefined): DefectProofItem | undefined {
  if (!defectProof?.items.length || !rootCauseGroupId) return undefined;
  return defectProof.items.find((item) => item.rootCauseGroupId === rootCauseGroupId);
}

export function isRootCauseProofReady(group: RootCauseGroup, defectProof?: DefectProofResult): boolean {
  if (group.status !== 'actionable') return false;
  if (!defectProof?.items.length) return true;
  const proof = proofItemForGroup(defectProof, group.id);
  return proof ? isProofReadyStatus(proof.status) : false;
}

export function proofReadyRootCauseGroups(groups: RootCauseGroup[], defectProof?: DefectProofResult): RootCauseGroup[] {
  return groups.filter((group) => isRootCauseProofReady(group, defectProof));
}

export function proofNeedsEvidenceItems(defectProof?: DefectProofResult): DefectProofItem[] {
  return defectProof?.items.filter((item) => item.status === 'needs-evidence') ?? [];
}

export function issueHasProofReadyRootCause(issue: Issue, issueDisposition?: IssueDispositionResult, defectProof?: DefectProofResult): boolean {
  if (!defectProof?.items.length) return true;
  const disposition = issueDisposition?.items.find((item) => item.issueId === issue.id);
  if (!disposition?.rootCauseGroupId) return true;
  const proof = proofItemForGroup(defectProof, disposition.rootCauseGroupId);
  return proof ? isProofReadyStatus(proof.status) : false;
}
