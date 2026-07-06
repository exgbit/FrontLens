import type { NetworkRecord, PageModel, PermissionCheckResult } from '../types.js';

const DANGER = /删除|移除|禁用|停用|作废|清空|重置密码|delete|remove|disable|destroy|clear/i;
const PERMISSION_ATTRS = ['data-permission', 'data-auth', 'data-role', 'permission'];

export class PermissionChecker {
  check(pageModel: PageModel, networkRecords: NetworkRecord[]): PermissionCheckResult[] {
    const authFailures = networkRecords.filter((record) => record.status === 401 || record.status === 403);
    const permissionMarked = pageModel.components.filter((component) => PERMISSION_ATTRS.some((attr) => component.attributes[attr]));
    const disabledActions = pageModel.buttons.filter((button) => button.visible && button.disabled);
    const visibleDangerWithoutMarker = pageModel.buttons.filter((button) => {
      const text = `${button.label ?? ''} ${button.text ?? ''}`;
      return button.visible && DANGER.test(text) && !PERMISSION_ATTRS.some((attr) => button.attributes[attr]);
    });
    const body = pageModel.stats.bodyTextSample;
    const pagePermissionDenied = /无权限|暂无权限|未授权|禁止访问|permission denied|forbidden|unauthorized/i.test(body);

    return [
      {
        id: 'PERM-001',
        rule: 'api-auth',
        status: authFailures.length > 0 ? 'failed' : 'passed',
        severity: authFailures.some((record) => record.status === 401 || record.status === 403) ? 'high' : 'info',
        title: '接口鉴权状态',
        description: '检查 Network 中是否存在 401/403 鉴权或权限失败。',
        count: authFailures.length,
        evidence: authFailures.slice(0, 30).map((record) => ({
          networkRequestId: record.id,
          details: { status: record.status, method: record.method, url: record.url }
        })),
        suggestion: {
          frontend: '统一处理 401/403：401 引导登录，403 展示无权限状态。',
          backend: '返回稳定权限错误码和 requestId，并确保权限校验一致。',
          priority: authFailures.length > 0 ? 'P1' : 'P3'
        }
      },
      {
        id: 'PERM-002',
        rule: 'permission-markers',
        status: permissionMarked.length > 0 ? 'passed' : 'warning',
        severity: 'low',
        title: '权限标记识别',
        description: '检查页面组件是否存在 data-permission/data-auth/data-role/permission 等权限标记。',
        count: permissionMarked.length,
        evidence: permissionMarked.slice(0, 30).map((component) => ({
          selector: component.selector,
          componentId: component.id,
          text: component.label ?? component.text,
          details: component.attributes
        })),
        suggestion: {
          frontend: '建议为受权限控制的菜单和按钮保留稳定权限标记，便于 QA、审计和自动化测试。',
          test: '补充不同角色下菜单、按钮、接口权限的矩阵测试。',
          priority: 'P3'
        }
      },
      {
        id: 'PERM-003',
        rule: 'visible-danger',
        status: visibleDangerWithoutMarker.length > 0 ? 'warning' : 'passed',
        severity: visibleDangerWithoutMarker.length > 0 ? 'medium' : 'info',
        title: '危险按钮权限标记',
        description: '检查删除、禁用、清空等危险按钮是否具备可识别权限标记。',
        count: visibleDangerWithoutMarker.length,
        evidence: visibleDangerWithoutMarker.slice(0, 30).map((button) => ({
          selector: button.selector,
          componentId: button.id,
          text: button.label ?? button.text,
          details: button.attributes
        })),
        suggestion: {
          frontend: '危险按钮建议绑定明确权限标记，并与后端权限码保持一致。',
          backend: '危险操作接口必须做服务端权限校验，不依赖前端隐藏按钮。',
          priority: visibleDangerWithoutMarker.length > 0 ? 'P2' : 'P3'
        }
      },
      {
        id: 'PERM-004',
        rule: 'disabled-actions',
        status: 'passed',
        severity: 'info',
        title: '禁用操作统计',
        description: '统计当前页面禁用按钮，用于辅助判断权限或状态控制。',
        count: disabledActions.length,
        evidence: disabledActions.slice(0, 30).map((button) => ({
          selector: button.selector,
          componentId: button.id,
          text: button.label ?? button.text,
          details: button.attributes
        })),
        suggestion: {
          frontend: '禁用按钮应配合 Tooltip 或说明解释原因，尤其是权限不足或状态不允许时。',
          priority: 'P3'
        }
      },
      {
        id: 'PERM-005',
        rule: 'page-permission',
        status: pagePermissionDenied ? 'warning' : 'passed',
        severity: pagePermissionDenied ? 'medium' : 'info',
        title: '页面权限状态',
        description: '检查页面可见文本中是否存在无权限/禁止访问提示。',
        count: pagePermissionDenied ? 1 : 0,
        evidence: pagePermissionDenied
          ? [
              {
                text: body.slice(0, 500)
              }
            ]
          : [],
        suggestion: {
          frontend: '无权限页面应提供清晰说明、返回入口和联系管理员信息。',
          backend: '页面权限与接口权限应保持一致，避免页面可见但接口 403。',
          priority: pagePermissionDenied ? 'P2' : 'P3'
        }
      }
    ];
  }
}
