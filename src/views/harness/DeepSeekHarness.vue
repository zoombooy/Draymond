<template>
  <section class="harness-view">
    <div class="harness-toolbar">
      <div class="mode-switch" role="tablist" :aria-label="t('harness.title')">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'web'"
          :class="['mode-tab', { active: mode === 'web' }]"
          @click="switchMode('web')"
        >{{ t('harness.sdkWebMode') }}</button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'sdk'"
          :class="['mode-tab', { active: mode === 'sdk' }]"
          @click="switchMode('sdk')"
        >{{ t('harness.sdkMode') }}</button>
      </div>
      <span v-if="mode === 'sdk'" class="sdk-status" :class="sdkState.status">
        {{ sdkStatusLabel }}
      </span>
    </div>

    <template v-if="mode === 'web'">
    <iframe
      v-if="status.status === 'ready' && status.url"
      :key="frameKey"
      :src="status.url"
      class="harness-frame"
      :title="t('harness.title')"
      allow="clipboard-read; clipboard-write"
    ></iframe>

    <div v-else class="harness-state">
      <div v-if="status.status === 'starting' || status.status === 'idle'" class="state-content">
        <LoaderCircle class="state-spinner" :size="30" :stroke-width="1.8" />
        <h1>{{ t('harness.starting') }}</h1>
        <p>{{ t('harness.startingDetail') }}</p>
      </div>

      <div v-else-if="status.status === 'config-required'" class="state-content">
        <Settings :size="32" :stroke-width="1.5" />
        <h1>{{ t('harness.modelRequired') }}</h1>
        <p>{{ t('harness.modelRequiredDetail') }}</p>
        <button class="command-button" @click="openModelSettings">
          <Settings :size="16" :stroke-width="1.8" />
          {{ t('harness.openSettings') }}
        </button>
      </div>

      <div v-else class="state-content">
        <CircleAlert :size="32" :stroke-width="1.5" />
        <h1>{{ t('harness.startFailed') }}</h1>
        <p class="error-message">{{ status.error || t('harness.unknownError') }}</p>
        <button class="command-button" @click="restartHarness">
          <RotateCcw :size="16" :stroke-width="1.8" />
          {{ t('harness.retry') }}
        </button>
      </div>
    </div>
    </template>

    <div v-else class="sdk-view">
      <div class="sdk-hint">{{ t('harness.sdkHint') }}</div>

      <div v-if="sdkState.status !== 'ready'" class="sdk-connect">
        <button class="command-button" :disabled="sdkState.status === 'starting'" @click="startSdkChannel">
          {{ sdkState.status === 'starting' ? t('harness.sdkStarting') : t('harness.sdkStart') }}
        </button>
        <p v-if="sdkState.error" class="error-message">{{ sdkState.error }}</p>
      </div>

      <div v-else class="sdk-session">
        <div class="sdk-messages" ref="messagesEl">
          <p v-if="sdkMessages.length === 0" class="sdk-empty">{{ t('harness.sdkEmpty') }}</p>
          <div v-for="(item, index) in sdkMessages" :key="index" :class="['sdk-message', `is-${item.role}`]">
            <span class="sdk-role">{{ roleLabel(item.role) }}</span>
            <div class="sdk-text">{{ item.text }}</div>
          </div>
        </div>
        <div class="sdk-composer">
          <input
            v-model="sdkInput"
            class="sdk-input"
            :placeholder="t('harness.sdkInputPlaceholder')"
            :disabled="sdkBusy"
            @keydown.enter.exact.prevent="sendSdkMessage"
          />
          <button class="command-button sdk-send" :disabled="sdkBusy || !sdkInput.trim()" @click="sendSdkMessage">
            {{ t('harness.sdkSend') }}
          </button>
          <button class="command-button" @click="stopSdkChannel">{{ t('harness.sdkStop') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Settings
} from 'lucide-vue-next'
import { electronService } from '@/services/electron'

const { t } = useI18n()
const router = useRouter()
const frameKey = ref(0)
const status = ref({
  status: 'idle',
  url: null,
  model: null,
  toolCount: 0,
  error: null
})

let unlistenStatus = null
let statusSyncPromise = null

// ---- P3 SDK 实验通道 ----
const mode = ref('web')
const sdkState = ref({ status: 'idle', error: null, sessionId: null })
const sdkMessages = ref([])
const sdkInput = ref('')
const sdkBusy = ref(false)
const messagesEl = ref(null)
let unlistenSdkEvent = null

const sdkStatusLabel = computed(() => {
  const labels = {
    ready: t('harness.sdkReady'),
    starting: t('harness.sdkStarting'),
    idle: t('harness.sdkDisconnected'),
    stopped: t('harness.sdkDisconnected')
  }
  return labels[sdkState.value.status] || sdkState.value.status
})

function roleLabel(role) {
  const keys = { user: 'sdkRoleUser', assistant: 'sdkRoleAssistant', system: 'sdkRoleSystem' }
  return t(`harness.${keys[role] || 'sdkRoleSystem'}`)
}

async function scrollMessagesToBottom() {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
}

function switchMode(next) {
  if (mode.value === next) return
  mode.value = next
  if (next === 'sdk') refreshSdkStatus()
}

async function refreshSdkStatus() {
  const current = await electronService.invoke('harness-sdk-status')
  if (current) sdkState.value = { ...sdkState.value, ...current }
}

async function startSdkChannel() {
  sdkState.value = { ...sdkState.value, status: 'starting', error: null }
  const next = await electronService.invoke('harness-sdk-start')
  if (next) {
    sdkState.value = { ...sdkState.value, ...next }
    if (next.status !== 'ready' && next.error) sdkMessages.value.push({ role: 'system', text: next.error })
  } else {
    sdkState.value = { ...sdkState.value, status: 'error', error: t('harness.unknownError') }
  }
}

async function stopSdkChannel() {
  await electronService.invoke('harness-sdk-stop')
  sdkState.value = { status: 'idle', error: null, sessionId: null }
}

async function sendSdkMessage() {
  const text = sdkInput.value.trim()
  if (!text || sdkBusy.value || sdkState.value.status !== 'ready') return
  sdkInput.value = ''
  sdkMessages.value.push({ role: 'user', text })
  await scrollMessagesToBottom()
  sdkBusy.value = true
  try {
    const result = await electronService.invoke('harness-sdk-prompt', text)
    if (result?.error) sdkMessages.value.push({ role: 'system', text: String(result.error) })
    await electronService.invoke('harness-sdk-wait')
  } catch (error) {
    sdkMessages.value.push({ role: 'system', text: error?.message || String(error) })
  } finally {
    sdkBusy.value = false
    await scrollMessagesToBottom()
  }
}

function handleSdkEvent(event) {
  const payload = event?.payload
  if (!payload || typeof payload.text !== 'string') return
  sdkMessages.value.push(payload)
  if (sdkMessages.value.length > 200) sdkMessages.value.shift()
  scrollMessagesToBottom()
}

async function startHarness() {
  status.value = { ...status.value, status: 'starting', error: null }
  const next = await electronService.invoke('harness-start')
  if (next) status.value = next
}

function syncHarnessStatus() {
  if (statusSyncPromise) return statusSyncPromise

  statusSyncPromise = (async () => {
    const current = await electronService.invoke('harness-status')
    if (current) status.value = current

    // The sidecar survives route changes. Start it only when it is not running,
    // so returning to this view does not temporarily remove the ready iframe.
    if (!current || current.status === 'idle') await startHarness()
  })().finally(() => {
    statusSyncPromise = null
  })

  return statusSyncPromise
}

async function restartHarness() {
  status.value = { ...status.value, status: 'starting', error: null }
  const next = await electronService.invoke('harness-restart')
  if (next) {
    status.value = next
    frameKey.value += 1
  }
}

function openModelSettings() {
  router.push('/settings/model')
}

onMounted(() => {
  unlistenStatus = electronService.listen('harness-status-changed', event => {
    status.value = event.payload
  })
  unlistenSdkEvent = electronService.listen('harness-sdk-event', handleSdkEvent)
  syncHarnessStatus()
  refreshSdkStatus()
})

onActivated(() => {
  syncHarnessStatus()
})

onUnmounted(() => {
  if (unlistenStatus) unlistenStatus()
  if (unlistenSdkEvent) unlistenSdkEvent()
})
</script>

<style scoped>
.harness-view {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-primary);
}

.harness-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
}

.mode-switch {
  display: inline-flex;
  padding: 2px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
}

.mode-tab {
  padding: 5px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.mode-tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.sdk-status {
  font-size: 12px;
  color: var(--text-tertiary);
}

.sdk-status.ready {
  color: var(--success-color, #16a34a);
}

.sdk-status.error {
  color: var(--error-color, #dc2626);
}

.harness-frame {
  display: block;
  width: 100%;
  flex: 1;
  min-height: 0;
  border: 0;
  background: #fff;
}

.sdk-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
}

.sdk-hint {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}

.sdk-connect {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.sdk-session {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sdk-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.sdk-empty {
  margin: auto;
  font-size: 13px;
  color: var(--text-tertiary);
}

.sdk-message {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 88%;
  align-self: flex-start;
}

.sdk-message.is-user {
  align-self: flex-end;
}

.sdk-role {
  font-size: 11px;
  color: var(--text-tertiary);
}

.sdk-text {
  padding: 9px 12px;
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.sdk-message.is-user .sdk-text {
  background: var(--accent-bg, var(--bg-hover));
}

.sdk-composer {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  align-items: center;
}

.sdk-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
}

.sdk-send {
  margin-top: 0;
}

.harness-state {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
}

.state-content {
  width: min(460px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  color: var(--text-secondary);
}

.state-content h1 {
  margin: 16px 0 8px;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0;
}

.state-content p {
  margin: 0;
  max-width: 420px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.65;
}

.state-spinner {
  animation: harness-spin 0.9s linear infinite;
}

.error-message {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  text-align: left;
}

.command-button {
  min-height: 34px;
  margin-top: 18px;
  padding: 7px 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  background: var(--bg-secondary);
  font-size: 13px;
  cursor: pointer;
}

.command-button:hover {
  background: var(--bg-hover);
}

@keyframes harness-spin {
  to { transform: rotate(360deg); }
}

</style>
