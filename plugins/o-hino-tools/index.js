/**
 * o-hino 工具审批策略插件
 * ==============================
 *
 * 替换原先由 harness/index.js 复制到 DSH home 的 toolApprovalPolicy.mjs。
 * 现在审批规则作为仓库内的一等插件存在，由 profile patch 按绝对路径挂载，
 * 审批工具列表来自 toolBridge.js 生成的单一清单。
 *
 * 工具调用本身仍经 mcp__o-hino__* 走本机 MCP 服务；后续 P1b 在确认
 * 0.2.x ctx.tools 注册 API 后，再把执行层也迁进插件。
 */
import { resolveToolApproval } from '../../src-electron/harness/toolBridge.js'

export const name = 'o-hino-tool-approval-policy'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const approvalTools = Array.isArray(config.approvalTools) ? config.approvalTools : []

  ctx.on('tools/pre-execute', async (execution, next) => {
    const decision = resolveToolApproval(execution, approvalTools)
    if (decision) return decision
    return next()
  })
}
