<template>
  <div class="bundle-settings-page">
    <button class="back-btn" :aria-label="t('note.back')" @click="goBack">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>

    <h1 class="page-title">{{ t('settings.bundlesTitle') }}</h1>
    <p class="page-desc">{{ t('settings.bundlesDesc') }}</p>

    <div class="settings-content">
      <section class="add-panel">
        <div class="panel-title">{{ t('settings.bundlesAddTitle') }}</div>
        <p class="panel-hint">{{ t('settings.bundlesAddHint') }}</p>
        <div class="add-row">
          <input
            v-model="inputValue"
            class="bundle-input"
            type="text"
            :placeholder="t('settings.bundlesInputPlaceholder')"
            :disabled="busy"
            @keyup.enter="handleAdd"
          />
          <button class="primary-btn" type="button" :disabled="busy || !inputValue.trim()" @click="handleAdd">
            {{ t('settings.bundlesAdd') }}
          </button>
        </div>
        <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      </section>

      <section class="list-panel">
        <div class="panel-title">{{ t('settings.bundlesInstalled') }}</div>
        <p v-if="bundles.length === 0" class="empty-state">{{ t('settings.bundlesEmpty') }}</p>
        <div v-else class="bundle-list">
          <div v-for="bundle in bundles" :key="bundle.id" class="bundle-item">
            <div class="bundle-info">
              <span class="bundle-name" :title="bundle.spec">{{ bundle.label || bundle.spec }}</span>
              <span class="bundle-spec" :title="bundle.spec">{{ bundle.spec }}</span>
            </div>
            <div class="bundle-actions">
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  :checked="bundle.enabled !== false"
                  :aria-label="t('settings.bundlesToggle')"
                  :disabled="busy"
                  @change="handleToggle(bundle, $event.target.checked)"
                />
                <span class="toggle-slider"></span>
              </label>
              <button class="danger-btn" type="button" :disabled="busy" @click="handleRemove(bundle)">
                {{ t('settings.bundlesRemove') }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <div v-if="restartHint" class="restart-notice">
        <span>{{ t('settings.bundlesRestartHint') }}</span>
        <button class="text-btn" type="button" @click="handleRestart">{{ t('settings.bundlesRestart') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { electronService } from '@/services/electron'

const router = useRouter()
const { t } = useI18n()

const bundles = ref([])
const inputValue = ref('')
const busy = ref(false)
const errorMessage = ref('')
const restartHint = ref(false)

async function loadBundles() {
  try {
    const result = await electronService.invoke('harness-bundles-list')
    bundles.value = Array.isArray(result?.bundles) ? result.bundles : []
  } catch (error) {
    errorMessage.value = error?.message || String(error)
  }
}

async function handleAdd() {
  const spec = inputValue.value.trim()
  if (!spec || busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await electronService.invoke('harness-bundles-add', { spec })
    bundles.value = Array.isArray(result?.bundles) ? result.bundles : bundles.value
    if (result?.restartRequired) restartHint.value = true
    inputValue.value = ''
  } catch (error) {
    errorMessage.value = error?.message || String(error)
  } finally {
    busy.value = false
  }
}

async function handleToggle(bundle, enabled) {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await electronService.invoke('harness-bundles-toggle', bundle.id, enabled)
    bundles.value = Array.isArray(result?.bundles) ? result.bundles : bundles.value
    if (result?.restartRequired) restartHint.value = true
  } catch (error) {
    errorMessage.value = error?.message || String(error)
  } finally {
    busy.value = false
  }
}

async function handleRemove(bundle) {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await electronService.invoke('harness-bundles-remove', bundle.id)
    bundles.value = Array.isArray(result?.bundles) ? result.bundles : bundles.value
    if (result?.restartRequired) restartHint.value = true
  } catch (error) {
    errorMessage.value = error?.message || String(error)
  } finally {
    busy.value = false
  }
}

async function handleRestart() {
  if (busy.value) return
  busy.value = true
  try {
    await electronService.invoke('harness-restart')
    restartHint.value = false
  } catch (error) {
    errorMessage.value = error?.message || String(error)
  } finally {
    busy.value = false
  }
}

const goBack = () => router.push('/settings')

onMounted(loadBundles)
</script>

<style scoped>
.bundle-settings-page {
  padding: 32px 40px;
  height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  color: var(--text-primary);
}

.back-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.back-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.page-title {
  font-size: 22px;
  font-weight: 600;
  margin: 12px 0 6px;
}

.page-desc {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0 0 24px;
  line-height: 1.6;
}

.settings-content {
  max-width: 780px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.add-panel,
.list-panel {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}

.panel-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 14px;
  line-height: 1.6;
}

.add-row {
  display: flex;
  gap: 10px;
}

.bundle-input {
  flex: 1;
  min-width: 0;
  padding: 9px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
}

.bundle-input:focus {
  outline: none;
  border-color: #10b981;
}

.primary-btn,
.danger-btn {
  padding: 9px 16px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}

.primary-btn {
  background: #10b981;
  color: #fff;
}

.primary-btn:disabled,
.danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.danger-btn {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.danger-btn:hover {
  color: #ef4444;
  border-color: #ef4444;
}

.error-message {
  color: #ef4444;
  font-size: 12px;
  margin: 10px 0 0;
}

.empty-state {
  color: var(--text-tertiary);
  font-size: 13px;
  margin: 0;
}

.bundle-list {
  display: flex;
  flex-direction: column;
}

.bundle-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--border-color);
}

.bundle-item:first-child {
  border-top: none;
}

.bundle-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.bundle-name {
  font-size: 13px;
  font-weight: 500;
}

.bundle-spec {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 420px;
}

.bundle-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 38px;
  height: 21px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  inset: 0;
  background: var(--border-color);
  border-radius: 21px;
  cursor: pointer;
  transition: background 0.2s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  width: 15px;
  height: 15px;
  left: 3px;
  bottom: 3px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background: #10b981;
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(17px);
}

.restart-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.text-btn {
  background: transparent;
  border: none;
  color: #10b981;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  white-space: nowrap;
}
</style>
