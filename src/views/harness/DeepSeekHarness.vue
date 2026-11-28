<template>
  <section class="harness-view">
    <div class="harness-toolbar">
      <div class="mode-switch" role="tablist" :aria-label="t('harness.title')">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'plugins'"
          :class="['mode-tab', { active: mode === 'plugins' }]"
          @click="switchMode('plugins')"
        >{{ t('harness.pluginsMode') }}</button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'sdk'"
          :class="['mode-tab', { active: mode === 'sdk' }]"
          @click="switchMode('sdk')"
        >{{ t('harness.sdkMode') }}</button>
      </div>
      <span class="host-status" :class="hostStatus.status">
        {{ hostStatusLabel }}
      </span>
    </div>

    <div v-if="mode === 'plugins'" class="plugins-view">
      <div class="summary-bar">
        <div class="summary-item">
          <span class="summary-label">{{ t('harness.hostMode') }}</span>
          <strong>{{ t('harness.localMode') }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ t('harness.pluginCount') }}</span>
          <strong>{{ t('harness.pluginCountValue', { count: loadedCount }) }}</strong>
        </div>
        <div class="summary-item">
          <span class="summary-label">{{ t('harness.toolCount') }}</span>
          <strong>{{ t('harness.toolCountValue', { count: hostStatus.toolCount || 0 }) }}</strong>
        </div>
        <div class="summary-item summary-model">
          <span class="summary-label">{{ t('harness.model') }}</span>
          <strong v-if="hostStatus.model">{{ modelLabel }}</strong>
          <div v-else class="model-missing">
            <strong>{{ modelLabel }}</strong>
            <button class="link-button" @click="openModelSettings">{{ t('harness.configureModel') }}</button>
          </div>
        </div>
      </div>

      <div v-if="hostStatus.error" class="error-banner">{{ hostStatus.error }}</div>
      <div v-if="notice" class="notice">{{ notice }}</div>

      <div class="panel">
        <div class="panel-head">
          <h2>{{ t('harness.pluginList') }}</h2>
          <button class="small-button" :disabled="busy" @click="reloadPlugins">
            <RotateCcw :size="14" :stroke-width="1.8" />
            {{ t('harness.reload') }}
          </button>
        </div>

        <p v-if="plugins.length === 0" class="empty">{{ t('harness.noPlugins') }}</p>

        <div v-for="plugin in plugins" :key="plugin.id" class="plugin-item">
          <div class="plugin-main">
            <div class="plugin-name">
              <span>{{ plugin.label }}</span>
              <span class="badge" :class="plugin.kind">
                {{ plugin.kind === 'builtin' ? t('harness.builtin') : t('harness.userPlugin') }}
              </span>
              <span class="load-dot" :class="{ on: plugin.loaded }"></span>
            </div>
            <div class="plugin-spec">{{ plugin.spec }}</div>
            <div class="plugin-meta">
              {{ t('harness.hooks') }}: {{ plugin.hooks?.length ? plugin.hooks.join(', ') : '-' }}
              <span v-if="plugin.error" class="plugin-error"> · {{ plugin.error }}</span>
            </div>
          </div>
          <div class="plugin-actions">
            <button
              v-if="plugin.kind === 'user'"
              class="small-button"
              :disabled="busy"
              @click="togglePlugin(plugin, !plugin.enabled)"
            >{{ plugin.enabled ? t('harness.disable') : t('harness.enable') }}</button>
            <button
              v-if="plugin.kind === 'user'"
              class="small-button danger"
              :disabled="busy"
              @click="removePlugin(plugin)"
            >{{ t('harness.remove') }}</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>{{ t('harness.addPlugin') }}</h2>
        </div>
        <div class="add-row">
          <input v-model="newSpec" class="text-input" :placeholder="t('harness.pluginSpecPlaceholder')" />
          <input v-model="newLabel" class="text-input narrow" :placeholder="t('harness.pluginLabelPlaceholder')" />
          <button class="small-button primary" :disabled="busy || !newSpec.trim()" @click="addPlugin">
            <Plus :size="14" :stroke-width="1.8" />
            {{ t('harness.add') }}
          </button>
        </div>
        <p class="hint">{{ t('harness.pluginHint') }}</p>
      </div>

      <div v-if="approvals.length > 0" class="panel">
        <div class="panel-head">
          <h2>{{ t('harness.approvalTitle') }}</h2>
        </div>
        <div v-for="item in approvals" :key="item.id" class="approval-item">
          <div>
            <strong>{{ item.tool || item.name }}</strong>
            <p>{{ item.reason }}</p>
          </div>
          <div class="approval-actions">
            <button class="small-button primary" @click="approve(item.id, true)">{{ t('harness.approve') }}</button>
            <button class="small-button" @click="approve(item.id, false)">{{ t('harness.deny') }}</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h2>{{ t('harness.toolTest') }}</h2>
        </div>
        <div class="tool-row">
          <select v-model="selectedTool" class="text-input">
            <option v-for="tool in tools" :key="tool.name" :value="tool.name">{{ tool.name }}</option>
          </select>
          <button class="small-button primary" :disabled="busy || !selectedTool" @click="invokeTool">
            <Play :size="14" :stroke-width="1.8" />
            {{ t('harness.invoke') }}
          </button>
        </div>
        <textarea v-model="toolArgs" class="args-input" rows="3" :aria-label="t('harness.toolArgs')"></textarea>
        <pre v-if="toolResult" class="tool-result" :class="{ error: toolResult.isError }">{{ toolResult.text }}</pre>
      </div>
    </div>

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
  Play,
  Plus,
  RotateCcw
} from 'lucide-vue-next'
import { electronService } from '@/services/electron'

const { t } = useI18n()
const router = useRouter()

const mode = ref('plugins')
const hostStatus = ref({
  status: 'idle',
  mode: 'local',
  model: null,
  toolCount: 0,
  pluginCount: 0,
  error: null
})
const plugins = ref([])
const tools = ref([])
const approvals = ref([])
const newSpec = ref('')
const newLabel = ref('')
const busy = ref(false)
const notice = ref('')
const selectedTool = ref('')
const toolArgs = ref('{}')
const toolResult = ref(null)

let unlistenStatus = null
let unlistenApproval = null
let unlistenApprovalResolved = null

const loadedCount = computed(() => plugins.value.filter(item => item.loaded).length)
const modelLabel = computed(() => {
  const model = hostStatus.value.model
  if (!model) return t('harness.notConfigured')
  return `${model.providerLabel || ''} / ${model.modelName || ''}`.trim()
})
const hostStatusLabel = computed(() => {
  const labels = {
    ready: t('harness.localReady'),
    starting: t('harness.localStarting'),
    idle: t('harness.localIdle'),
    error: t('harness.localError'),
    'config-required': t('harness.localIdle')
  }
  return labels[hostStatus.value.status] || hostStatus.value.status
})

function switchMode(next) {
  if (mode.value === next) return
  mode.value = next
  if (next === 'sdk') refreshSdkStatus()
  else refreshPlugins()
}

async function refreshPlugins() {
  const snapshot = await electronService.invoke('harness-plugins-list')
  if (!snapshot) return
  if (snapshot.status) hostStatus.value = { ...hostStatus.value, ...snapshot.status }
  plugins.value = snapshot.plugins || []
  tools.value = snapshot.tools || []
  approvals.value = snapshot.approvals || []
  if (!selectedTool.value && tools.value.length) selectedTool.value = tools.value[0].name
}

async function startHost() {
  hostStatus.value = { ...hostStatus.value, status: 'starting', error: null }
  const next = await electronService.invoke('harness-start')
  if (next) hostStatus.value = { ...hostStatus.value, ...next }
  await refreshPlugins()
}

async function reloadPlugins() {
  busy.value = true
  const snapshot = await electronService.invoke('harness-plugins-reload')
  if (snapshot) {
    if (snapshot.status) hostStatus.value = { ...hostStatus.value, ...snapshot.status }
    plugins.value = snapshot.plugins || []
    tools.value = snapshot.tools || []
    approvals.value = snapshot.approvals || []
  }
  busy.value = false
}

async function addPlugin() {
  const spec = newSpec.value.trim()
  if (!spec || busy.value) return
  busy.value = true
  notice.value = ''
  const result = await electronService.invoke('harness-plugins-add', {
    spec,
    label: newLabel.value.trim()
  })
  busy.value = false
  if (!result || result.ok === false) {
    notice.value = result?.error || t('harness.unknownError')
    return
  }
  newSpec.value = ''
  newLabel.value = ''
  if (result.error) {
    notice.value = t('harness.pluginLoadFailed', { error: result.error })
  } else if (result.loaded === false) {
    notice.value = t('harness.pluginRegistered')
  } else {
    notice.value = result.added ? t('harness.pluginAdded') : t('harness.pluginUpdated')
  }
  await refreshPlugins()
}

async function removePlugin(plugin) {
  if (busy.value) return
  busy.value = true
  await electronService.invoke('harness-plugins-remove', plugin.id)
  busy.value = false
  notice.value = t('harness.pluginRemoved')
  await refreshPlugins()
}

async function togglePlugin(plugin, enabled) {
  if (plugin.kind === 'builtin') {
    notice.value = t('harness.builtinAlwaysOn')
    return
  }
  if (busy.value) return
  busy.value = true
  const result = await electronService.invoke('harness-plugins-toggle', plugin.id, enabled)
  busy.value = false
  if (result && result.ok === false) notice.value = result.error
  await refreshPlugins()
}

async function invokeTool() {
  if (!selectedTool.value || busy.value) return
  let args = {}
  try {
    args = JSON.parse(toolArgs.value || '{}')
  } catch (error) {
    toolResult.value = { isError: true, text: error.message }
    return
  }
  busy.value = true
  toolResult.value = null
  const result = await electronService.invoke('harness-plugins-invoke', selectedTool.value, args)
  toolResult.value = result || { isError: true, text: t('harness.unknownError') }
  busy.value = false
}

async function approve(id, allowed) {
  await electronService.invoke('harness-plugins-approve', id, allowed)
  await refreshPlugins()
}

function openModelSettings() {
  router.push('/settings/model')
}

// ---- DSH 可选通道：默认不启用，仅用于兼容性验证 ----
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
    await electronService.invoke('harness-sdk-prompt', text)
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

onMounted(() => {
  unlistenStatus = electronService.listen('harness-status-changed', event => {
    hostStatus.value = { ...hostStatus.value, ...event.payload }
  })
  unlistenApproval = electronService.listen('harness-plugin-approval', () => refreshPlugins())
  unlistenApprovalResolved = electronService.listen('harness-plugin-approval-resolved', () => refreshPlugins())
  unlistenSdkEvent = electronService.listen('harness-sdk-event', handleSdkEvent)
  startHost()
  refreshSdkStatus()
})

onActivated(() => {
  refreshPlugins()
})

onUnmounted(() => {
  if (unlistenStatus) unlistenStatus()
  if (unlistenApproval) unlistenApproval()
  if (unlistenApprovalResolved) unlistenApprovalResolved()
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

.host-status {
  font-size: 12px;
  color: var(--text-tertiary);
}

.host-status.ready {
  color: var(--success-color, #16a34a);
}

.host-status.error {
  color: var(--error-color, #dc2626);
}

.plugins-view {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.summary-bar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.summary-label {
  font-size: 11px;
  color: var(--text-tertiary);
}

.summary-item strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.summary-model {
  margin-left: auto;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-missing {
  display: flex;
  align-items: center;
  gap: 8px;
}

.link-button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--primary-color, #2563eb);
  font-size: 12px;
  cursor: pointer;
}

.link-button:hover {
  text-decoration: underline;
}

.panel {
  flex: 0 0 auto;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  padding: 12px 14px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.panel-head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.plugin-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--border-color);
}

.plugin-main {
  min-width: 0;
  flex: 1;
}

.plugin-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
}

.plugin-spec {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  overflow-wrap: anywhere;
}

.plugin-meta {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.plugin-error {
  color: var(--error-color, #dc2626);
}

.badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.badge.builtin {
  background: var(--accent-bg, var(--bg-hover));
  color: var(--text-primary);
}

.load-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
}

.load-dot.on {
  background: var(--success-color, #16a34a);
}

.plugin-actions,
.approval-actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}

.small-button {
  min-height: 28px;
  padding: 4px 10px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.small-button:hover {
  background: var(--bg-hover);
}

.small-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.small-button.primary {
  border-color: var(--accent-color, var(--border-color));
}

.small-button.danger {
  color: var(--error-color, #dc2626);
}

.add-row,
.tool-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.text-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
}

.text-input.narrow {
  max-width: 180px;
}

.args-input {
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-mono, monospace);
  resize: vertical;
}

.tool-result {
  margin: 8px 0 0;
  padding: 10px;
  max-height: 160px;
  overflow: auto;
  border-radius: 5px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.tool-result.error {
  color: var(--error-color, #dc2626);
}

.approval-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--border-color);
}

.approval-item p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.empty,
.hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.error-banner,
.notice {
  flex: 0 0 auto;
  padding: 9px 12px;
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
}

.error-banner {
  background: var(--danger-bg, var(--bg-secondary));
  color: var(--error-color, #dc2626);
}

.notice {
  background: var(--bg-secondary);
  color: var(--text-secondary);
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

.error-message {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  text-align: left;
}
</style>
