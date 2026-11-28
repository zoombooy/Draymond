export const MODEL_STORAGE_KEY = 'o-hino-custom-models';
export const SELECTED_MODEL_KEY = 'o-hino-selected-model';
export const WORKSPACE_STORAGE_KEY = 'o-hino-workspaces';
export const SELECTED_WORKSPACE_KEY = 'o-hino-selected-workspace';

export const providerIcons = {
  doubao: new URL('@/assets/images/豆包.png', import.meta.url).href,
  qwen: new URL('@/assets/images/千问.png', import.meta.url).href,
  zhipu: new URL('@/assets/images/智谱logo.png', import.meta.url).href,
  deepseek: new URL('@/assets/images/deepseek.png', import.meta.url).href,
  kimi: new URL('@/assets/images/kimi-icon.png', import.meta.url).href,
  minimax: new URL('@/assets/images/MiniMax.png', import.meta.url).href,
  openai: new URL('@/assets/images/OpenAI.svg', import.meta.url).href,
  tongyi: new URL('@/assets/images/通义千问.svg', import.meta.url).href,
  stepfun: new URL('@/assets/images/阶跃星辰.svg', import.meta.url).href,
  siliconflow: new URL('@/assets/images/硅基流动.svg', import.meta.url).href,
  xiaomi: new URL('@/assets/images/小米.svg', import.meta.url).href,
  other: new URL('@/assets/images/其他模型.png', import.meta.url).href
};

// 常见模型能力关键词表：按模型名（小写）匹配，命中即认为具备该能力。
// 仅用于展示角标，不参与实际请求；真实能力以模型提供方为准。
const CAPABILITY_KEYWORDS = {
  vision: ['vision', 'vl', 'multimodal', '多模态', '4o', '4.1', 'gemini', 'gpt-4', 'claude', 'qvq', 'vl-max', '闪', 'omni', 'step-5', 'step-3.7', 'mimo-v2.6-pro', 'mimo-v2.5-omni'],
  reasoning: ['reasoning', 'reasoner', 'r1', 'qwq', 'o1', 'o3', 'thinking', '深度思考', 'math', 'step-3.5', 'mimo', 'qvq'],
  tools: ['function', 'tool', 'agent', 'mcp', 'react', 'coder', 'code'],
  code: ['code', 'coder', 'coding', '代码']
};

// 上下文长度推断：优先识别模型名中的显式标记，再按模型族给默认值。
const CONTEXT_PATTERNS = [
  { re: /(?:^|[-_/])1m(?:$|[-_/])|1000k|1m-context/i, label: '1M' },
  { re: /512k/i, label: '512K' },
  { re: /256k/i, label: '256K' },
  { re: /200k/i, label: '200K' },
  { re: /128k/i, label: '128K' },
  { re: /64k/i, label: '64K' },
  { re: /32k/i, label: '32K' }
];

const CONTEXT_FAMILY_DEFAULTS = [
  { re: /deepseek-v4|deepseek-v3|deepseek-chat/i, label: '128K' },
  { re: /qwen3|qwen-3/i, label: '128K' },
  { re: /kimi|minimax/i, label: '200K' },
  { re: /gpt-4o|gpt-4\.1|claude/i, label: '128K' },
  { re: /glm-4/i, label: '128K' },
  { re: /step-5/i, label: '1M' },
  { re: /mimo-v2/i, label: '1M' }
];

export function inferContextLabel(modelName = '') {
  const name = String(modelName || '');
  for (const item of CONTEXT_PATTERNS) {
    if (item.re.test(name)) return item.label;
  }
  for (const item of CONTEXT_FAMILY_DEFAULTS) {
    if (item.re.test(name)) return item.label;
  }
  return '';
}

export function inferCapabilities(model = {}) {
  const name = String(model.modelName || model.name || '').toLowerCase();
  const caps = {
    vision: false,
    reasoning: false,
    tools: false,
    code: false,
    embedding: !!(model.embeddingModelName || model.embeddingName)
  };
  for (const [key, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
    caps[key] = keywords.some(word => name.includes(word));
  }
  return caps;
}

export const CHAT_MODES = [
  { value: 'chat', i18n: 'modeChat' },
  { value: 'memoryless', i18n: 'modeMemoryless' },
  { value: 'agent', i18n: 'modeAgent' },
  { value: 'create', i18n: 'modeCreate' },
  { value: 'arena', i18n: 'modeArena' }
];

// 创造模式的产出目标。keywords 用于根据用户输入推荐目标，命中词会展示给用户说明推荐依据。
// auto 表示不预设目标，由 Agent 根据对话自行判断；other 覆盖未归入前三类的创造任务。
export const CREATE_TARGETS = [
  {
    value: 'auto',
    i18n: 'createTargetAuto',
    descI18n: 'createTargetAutoDesc',
    icon: '<circle cx="12" cy="12" r="9"></circle><path d="M12 8v8M8 12h8"></path>',
    keywords: []
  },
  {
    value: 'skill',
    i18n: 'createTargetSkill',
    descI18n: 'createTargetSkillDesc',
    icon: '<path d="M12 3l2.4 5.3 5.6.6-4.2 3.8 1.2 5.5L12 15.3 7 18.2l1.2-5.5L4 8.9l5.6-.6z"></path>',
    keywords: ['技能', 'skill', '工作流', '工作流程', '流程', '方法论', 'sop', '提示词模板', 'prompt', '经验沉淀', '沉淀', '复用', '可复用', '套路', '最佳实践']
  },
  {
    value: 'tool',
    i18n: 'createTargetTool',
    descI18n: 'createTargetToolDesc',
    icon: '<path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3z"></path>',
    keywords: ['工具', 'tool', '函数', 'function', '工具函数', '封装', '脚本', 'script', 'api', '接口', '调用', '命令行', 'cli', '自动化']
  },
  {
    value: 'plugin',
    i18n: 'createTargetPlugin',
    descI18n: 'createTargetPluginDesc',
    icon: '<path d="M12 2v6M12 16v6M2 12h6M16 12h6"></path><rect x="8" y="8" width="8" height="8" rx="1"></rect>',
    keywords: ['插件', 'plugin', '扩展', 'extension', '接入', '集成', 'mcp', '第三方', 'bundle', 'tgz', '安装到', '应用市场']
  },
  {
    value: 'other',
    i18n: 'createTargetOther',
    descI18n: 'createTargetOtherDesc',
    icon: '<circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 4.5 1.5c-.8 1-2 1.5-2 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    keywords: []
  }
];

// 根据用户输入推荐创造目标：按命中关键词加权取最高分，无命中时归为 other。
// 返回结果包含命中的词，供 UI 展示推荐依据。
export function recommendCreateTarget(text = '') {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return { value: 'auto', hits: [] };
  let best = null;
  for (const target of CREATE_TARGETS) {
    if (!target.keywords || target.keywords.length === 0) continue;
    const hits = target.keywords.filter(word => lower.includes(String(word).toLowerCase()));
    if (hits.length === 0) continue;
    const score = hits.reduce((sum, word) => sum + (String(word).length > 2 ? 2 : 1), 0);
    if (!best || score > best.score) best = { value: target.value, score, hits };
  }
  if (!best) return { value: 'other', hits: [] };
  return { value: best.value, hits: best.hits };
}
