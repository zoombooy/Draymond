<template>
  <div class="arena-result">
    <div class="arena-header">
      <div class="arena-heading">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"></path>
          <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"></path>
        </svg>
        <span>{{ t('friday.modeArena') }}</span>
        <span class="arena-meta">{{ run.participants.length }} {{ t('friday.arenaModels') }}</span>
      </div>
      <span class="arena-status" :class="{ done: allDone }">
        {{ allDone ? t('friday.arenaDone') : t('friday.arenaRunning') }}
      </span>
    </div>

    <div class="arena-task">{{ run.userMessage }}</div>

    <div class="arena-grid">
      <article
        v-for="participant in run.participants"
        :key="participant.modelId"
        class="arena-card"
        :class="{ done: participant.done, failed: !!participant.error }"
      >
        <header class="arena-card-head">
          <img :src="providerIcons[participant.provider] || providerIcons.other" class="arena-icon" alt="" />
          <div class="arena-model-info">
            <span class="arena-model-name">{{ participant.modelName }}</span>
            <span v-if="participant.providerLabel" class="arena-provider">{{ participant.providerLabel }}</span>
          </div>
          <span class="arena-badge" :class="{ done: participant.done, failed: !!participant.error }">
            {{ statusFor(participant) }}
          </span>
        </header>

        <div class="arena-card-body">
          <div v-if="participant.error" class="arena-error">{{ participant.error }}</div>
          <div
            v-else-if="participant.content"
            class="arena-content markdown-body"
            v-html="renderMarkdown(participant.content)"
          ></div>
          <div v-else class="arena-waiting">
            <span class="arena-dot"></span>{{ t('friday.arenaWaiting') }}
          </div>
        </div>

        <footer class="arena-card-foot">
          <span class="arena-elapsed">
            {{ participant.elapsedMs ? `${(participant.elapsedMs / 1000).toFixed(1)}s` : '—' }}
          </span>
          <button
            v-if="participant.content"
            class="arena-copy"
            type="button"
            :disabled="!participant.done"
            @click="copyContent(participant.content)"
          >
            {{ copiedId === participant.modelId ? t('friday.arenaCopied') : t('friday.arenaCopy') }}
          </button>
        </footer>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { renderMarkdown } from '@/utils/markdown';
import { providerIcons } from '@/views/friday/constants';

const props = defineProps({
  run: { type: Object, required: true }
});

const { t } = useI18n();
const copiedId = ref('');

const allDone = computed(() => (
  props.run.participants.length > 0 &&
  props.run.participants.every(p => p.done || p.error)
));

function statusFor(participant) {
  if (participant.error) return t('friday.arenaFailed');
  if (participant.done) return t('friday.arenaDone');
  if (participant.streaming) return t('friday.arenaRunning');
  return t('friday.arenaWaiting');
}

async function copyContent(content) {
  try {
    await navigator.clipboard.writeText(content);
    copiedId.value = props.run.participants.find(p => p.content === content)?.modelId || '';
    setTimeout(() => { copiedId.value = ''; }, 1500);
  } catch (error) {
    console.error('Arena copy failed:', error);
  }
}
</script>

<style scoped>
.arena-result {
  margin: 10px 0 18px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-secondary);
}

.arena-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.arena-heading {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.arena-meta {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-tertiary);
}

.arena-status {
  padding: 3px 9px;
  border-radius: 20px;
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  font-size: 11px;
  white-space: nowrap;
}

.arena-status.done {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.arena-task {
  margin: 10px 0 14px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.arena-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
}

.arena-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
  overflow: hidden;
}

.arena-card.done {
  border-color: rgba(16, 185, 129, 0.35);
}

.arena-card.failed {
  border-color: rgba(239, 68, 68, 0.35);
}

.arena-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
}

.arena-icon {
  width: 20px;
  height: 20px;
  border-radius: 5px;
  flex-shrink: 0;
}

.arena-model-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.arena-model-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arena-provider {
  font-size: 10px;
  color: var(--text-tertiary);
}

.arena-badge {
  padding: 2px 7px;
  border-radius: 12px;
  background: var(--bg-hover);
  color: var(--text-tertiary);
  font-size: 10px;
  white-space: nowrap;
}

.arena-badge.done {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.arena-badge.failed {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.arena-card-body {
  flex: 1;
  min-height: 120px;
  max-height: 420px;
  overflow-y: auto;
  padding: 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-primary);
}

.arena-content {
  word-break: break-word;
}

.arena-error {
  color: #ef4444;
}

.arena-waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-tertiary);
}

.arena-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3b82f6;
  animation: arena-pulse 1.2s infinite;
}

@keyframes arena-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}

.arena-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-top: 1px solid var(--border-color);
  font-size: 10.5px;
  color: var(--text-tertiary);
}

.arena-copy {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 5px;
}

.arena-copy:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.arena-copy:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
