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
