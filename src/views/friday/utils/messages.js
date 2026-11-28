export function getAssistantContent(msg) {
  if (!msg || msg.role !== 'assistant') return '';
  if (msg.content?.trim()) return msg.content;
  if (Array.isArray(msg.segments) && msg.segments.length) {
    return msg.segments
      .filter(seg => seg.type === 'text' && seg.content)
      .map(seg => seg.content)
      .join('\n\n');
  }
  return '';
}

function parseMetadata(raw) {
  const metadata = raw?.metadata;
  if (!metadata) return null;
  if (typeof metadata === 'object') return metadata;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch (_e) {
      return null;
    }
  }
  return null;
}

export function mapHistoryMessage(raw) {
  const metadata = parseMetadata(raw);
  const reasoning = raw?.reasoning
    || raw?.reasoningContent
    || metadata?.reasoning
    || metadata?.reasoningContent
    || '';
  const msg = {
    role: raw.role,
    content: raw.content,
    id: raw.id,
    reasoning
  };
  if (metadata?.segments && Array.isArray(metadata.segments)) {
    msg.segments = metadata.segments;
  }
  if (metadata?.sources && Array.isArray(metadata.sources)) {
    msg.sources = metadata.sources;
  }
  // 竞技模式：用户消息带 arenaRunId，模型答案带 arena 标记与模型信息
  if (metadata?.arenaRunId) {
    msg.arenaRunId = metadata.arenaRunId;
  }
  if (metadata?.arena) {
    msg.arena = {
      arenaRunId: metadata.arenaRunId || '',
      modelId: metadata.modelId || '',
      modelName: metadata.modelName || '',
      provider: metadata.provider || '',
      providerLabel: metadata.providerLabel || '',
      elapsedMs: metadata.elapsedMs || 0,
      error: metadata.error || ''
    };
  }
  return msg;
}

export function findTurnStartUserIndex(messages, aiMsgIndex) {
  if (aiMsgIndex <= 0 || messages[aiMsgIndex]?.role !== 'assistant') return -1;
  let index = aiMsgIndex - 1;
  while (index >= 0 && messages[index].role !== 'assistant') {
    index--;
  }
  const start = index + 1;
  if (start < aiMsgIndex && messages[start]?.role === 'user') return start;
  return -1;
}

export function formatClock(date = new Date()) {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}
