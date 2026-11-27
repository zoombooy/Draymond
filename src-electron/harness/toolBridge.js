/**
 * Friday 工具 -> DeepSeek Harness 工具清单桥接层
 * ==============================================
 *
 * 把 agent/tools/registry.js 中标记了 `exposedViaMcp: true` 的工具定义，
 * 转成 Harness 插件可直接消费的清单。这样工具名、审批工具列表只有一处真相，
 * 不再由 harness/index.js 与 toolApprovalPolicy.mjs 各自拼一遍。
 *
 * 本文件不依赖 Electron / LangChain / zod，纯函数便于 node:test 验证。
 */

export const MCP_SERVER_NAME = 'o-hino'

/**
 * @param {Array<{name:string, description?:string, meta?:Object}>} definitions
 * @param {{serverName?: string}} options
 * @returns {{tools: Array, approvalTools: string[], toolCount: number}}
 */
export function buildHarnessToolManifest(definitions = [], options = {}) {
  const serverName = options.serverName || MCP_SERVER_NAME
  const tools = []
  const approvalTools = []

  for (const def of definitions) {
    if (!def || typeof def.name !== 'string') continue
    // 与既有行为一致：只有显式标记 exposedViaMcp 的工具才对 Harness 可见。
    if (def.meta?.exposedViaMcp !== true) continue

    const name = `mcp__${serverName}__${def.name}`
    const requireApproval = def.meta?.requireApproval === true
    tools.push({
      name,
      description: def.description || '',
      sourceTool: def.name,
      requireApproval
    })
    if (requireApproval) approvalTools.push(name)
  }

  return { tools, approvalTools, toolCount: tools.length }
}

/** 生成注入插件的审批配置 */
export function buildApprovalPolicyConfig(manifest) {
  return { approvalTools: manifest.approvalTools || [] }
}

/**
 * 判断一次工具执行是否需要转为人工审批。
 * 返回 null 表示放行，交由插件调用 next()。
 */
export function resolveToolApproval(execution = {}, approvalTools = []) {
  const names = Array.isArray(approvalTools) ? approvalTools : []
  if (!names.includes(execution.name)) return null
  return {
    kind: 'ask',
    reason: `Friday 工具 "${execution.name}" 会修改应用数据，请确认后继续。`
  }
}
