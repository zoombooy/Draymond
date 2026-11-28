<template>
  <div class="settings-page">
    <h1 class="settings-title">{{ t('settings.title') }}</h1>

    <div class="settings-content">
      <!-- 通用设置 -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.general') }}</div>
        <div class="group-content">
          <div class="setting-item">
            <span class="item-label">{{ t('settings.displayMode') }}</span>
            <div class="theme-select-wrapper" ref="themeSelectRef">
              <div class="theme-select-trigger" @click="toggleThemeDropdown">
                <span>{{ currentThemeLabel }}</span>
                <svg class="theme-select-arrow" :class="{ expanded: showThemeDropdown }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              <div v-if="showThemeDropdown" class="theme-dropdown-menu">
                <div
                  v-for="option in themeOptions"
                  :key="option.value"
                  :class="['theme-dropdown-item', { active: settings.displayMode === option.value }]"
                  @click="selectTheme(option.value)"
                >
                  <span>{{ option.label }}</span>
                  <svg v-if="settings.displayMode === option.value" class="check-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
              </div>
            </div>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.fontSize') }}</span>
            <div class="font-size-options">
              <div
                v-for="option in fontSizeOptions"
                :key="option.value"
                :class="['font-size-option', { active: settings.fontSize === option.value }]"
                @click="settings.fontSize = option.value"
              >
                {{ option.label }}
              </div>
            </div>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.language') }}</span>
            <div class="theme-select-wrapper" ref="langSelectRef">
              <div class="theme-select-trigger" @click="toggleLangDropdown">
                <span>{{ currentLangLabel }}</span>
                <svg class="theme-select-arrow" :class="{ expanded: showLangDropdown }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              <div v-if="showLangDropdown" class="theme-dropdown-menu">
                <div
                  v-for="option in langOptions"
                  :key="option.value"
                  :class="['theme-dropdown-item', { active: currentLanguage === option.value }]"
                  @click="selectLanguage(option.value)"
                >
                  <span>{{ option.label }}</span>
                  <svg v-if="currentLanguage === option.value" class="check-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
              </div>
            </div>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.messageNotify') }}</span>
            <label class="toggle-switch">
              <input type="checkbox" v-model="settings.messageNotify" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.scheduleDefaultView') }}</span>
            <div class="font-size-options">
              <div
                :class="['font-size-option', { active: settings.scheduleDefaultView === 'week' }]"
                @click="selectScheduleView('week')"
              >{{ t('settings.viewWeek') }}</div>
              <div
                :class="['font-size-option', { active: settings.scheduleDefaultView === 'month' }]"
                @click="selectScheduleView('month')"
              >{{ t('settings.viewMonth') }}</div>
              <div
                :class="['font-size-option', { active: settings.scheduleDefaultView === 'quadrant' }]"
                @click="selectScheduleView('quadrant')"
              >{{ t('settings.viewQuadrant') }}</div>
            </div>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.reminderLead') }}</span>
            <div class="font-size-options">
              <div
                v-for="opt in reminderLeadOptions"
                :key="opt.value"
                :class="['font-size-option', { active: settings.reminderLeadMinutes === opt.value }]"
                @click="selectReminderLead(opt.value)"
              >{{ opt.label }}</div>
            </div>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.reminderAllDayTime') }}</span>
            <input
              type="time"
              v-model="settings.reminderAllDayTime"
              class="text-input reminder-time-input"
              @change="saveReminderConfig"
            />
          </div>
          <div class="setting-item clickable" @click="goToFileOpenSettings">
            <div class="item-label-group">
              <span class="item-label">{{ t('settings.fileOpen') }}</span>
              <span class="item-hint">{{ t('settings.fileOpenDesc') }}</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="arrow-icon"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        </div>
      </div>

      <!-- 功能模块 -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.modules') }}</div>
        <div class="group-content">
          <div class="setting-item clickable" @click="goToModuleSettings">
            <div class="item-label-group">
              <span class="item-label">{{ t('settings.sidebarModules') }}</span>
              <span class="item-hint">{{ t('settings.sidebarModulesHint', { count: enabledModuleCount, total: sidebarModuleCount }) }}</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="arrow-icon"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <div class="setting-item clickable" @click="goToBundleSettings">
            <div class="item-label-group">
              <span class="item-label">{{ t('settings.bundles') }}</span>
              <span class="item-hint">{{ t('settings.bundlesHint') }}</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="arrow-icon"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <div class="setting-item clickable" @click="goToFlywheelSettings">
            <div class="item-label-group">
              <span class="item-label">{{ t('settings.flywheelTitle') }}</span>
              <span class="item-hint">{{ t('settings.flywheelHint') }}</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="arrow-icon"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
        </div>
      </div>

      <!-- AI工具 -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.aiTools') }}</div>
        <div class="group-content">
          <div class="setting-item clickable" @click="goToModelSettings">
            <span class="item-label">{{ t('settings.modelSettings') }}</span>
            <span class="item-link">
              {{ t('settings.customModelHint') }}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </span>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.noteFimCompletion') }}</span>
            <label class="toggle-switch">
              <input type="checkbox" v-model="settings.noteFimCompletion" @change="saveNoteFimCompletion" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- Python 环境 -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.pythonEnv') }}</div>
        <div class="group-content">
          <!-- 当前状态 -->
          <div class="setting-item">
            <span class="item-label">{{ t('settings.pythonStatus') }}</span>
            <span class="item-link" :class="{ 'python-ok': pythonState.available, 'python-warn': !pythonState.available }">
              <template v-if="pythonState.loading">…</template>
              <template v-else-if="!pythonState.available && pythonState.reason === 'not_configured'">
                {{ t('settings.pythonNotConfigured') }}
              </template>
              <template v-else-if="!pythonState.available">
                {{ t('settings.pythonUnavailable') }}
              </template>
              <template v-else>
                {{ t('settings.pythonReady') }} · {{ pythonState.version }}
              </template>
            </span>
          </div>
          <!-- 已配置路径 -->
          <div class="setting-item clickable" @click="selectPythonFile">
            <span class="item-label">{{ t('settings.pythonPath') }}</span>
            <span class="item-link">
              {{ pythonState.configured ? shortenPath(pythonState.configured) : t('settings.pythonPathHint') }}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </span>
          </div>
          <!-- 自动检测（含依赖校验） -->
          <div class="setting-item">
            <span class="item-label">{{ t('settings.pythonAutoDetect') }}</span>
            <button
              class="action-btn"
              :disabled="detectBusy"
              @click="autoDetectPython"
            >
              {{ detectBtnLabel }}
            </button>
          </div>
        </div>
      </div>

      <!-- 数据备份 -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.backup') }}</div>
        <div class="group-content">
          <div class="setting-item">
            <span class="item-label">{{ t('settings.backupNow') }}</span>
            <button
              class="action-btn"
              :disabled="backupState.backing"
              @click="handleBackup"
            >
              {{ backupState.backing ? t('settings.backing') : t('settings.createBackup') }}
            </button>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.exportAllNotes') }}</span>
            <button class="action-btn" :disabled="noteExporting" @click="handleExportAllNotes">
              {{ noteExporting ? t('settings.exportingNotes') : t('settings.exportNotes') }}
            </button>
          </div>
          <div v-if="backupProgress.active" class="setting-item backup-progress-item">
            <div class="backup-progress-content">
              <div class="backup-progress-main">
                <span class="item-label">{{ backupProgressLabel }}</span>
                <span class="item-link">{{ backupProgress.compressing ? '' : (backupProgressPercent + '%') }}</span>
              </div>
              <div class="backup-progress-bar">
                <div class="backup-progress-fill" :style="{ width: backupProgressPercent + '%' }"></div>
              </div>
              <div v-if="backupProgress.name && !backupProgress.compressing" class="backup-progress-file" :title="backupProgress.name">
                {{ backupProgress.name }}
              </div>
            </div>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.restoreData') }}</span>
            <button
              class="text-btn"
              :disabled="backupState.restoring"
              @click="handleRestore"
            >
              {{ backupState.restoring ? t('settings.restoring') : t('settings.restoreFromBackup') }}
            </button>
          </div>
          <div class="setting-item">
            <span class="item-label">{{ t('settings.autoBackup') }}</span>
            <label class="toggle-switch">
              <input type="checkbox" v-model="backupConfig.enabled" @change="saveBackupConfig" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div v-if="backupConfig.enabled" class="setting-item">
            <span class="item-label">{{ t('settings.backupFrequency') }}</span>
            <div class="font-size-options">
              <div
                :class="['font-size-option', { active: backupConfig.interval === 'daily' }]"
                @click="setBackupInterval('daily')"
              >{{ t('settings.daily') }}</div>
              <div
                :class="['font-size-option', { active: backupConfig.interval === 'weekly' }]"
                @click="setBackupInterval('weekly')"
              >{{ t('settings.weekly') }}</div>
            </div>
          </div>
          <div v-if="backupConfig.enabled" class="setting-item clickable" @click="selectBackupDir">
            <span class="item-label">{{ t('settings.backupDir') }}</span>
            <span class="item-link">
              {{ backupConfig.autoDir ? shortenPath(backupConfig.autoDir) : t('settings.notSet') }}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </span>
          </div>
          <div v-if="backupConfig.lastBackupAt" class="setting-item">
            <span class="item-label">{{ t('settings.lastBackupTime') }}</span>
            <span class="item-link">{{ formatBackupTime(backupConfig.lastBackupAt) }}</span>
          </div>
        </div>
      </div>

      <!-- 数据存储 -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.dataStorage') }}</div>
        <div class="group-content">
          <div class="setting-item clickable" @click="selectDataDir">
            <div class="item-label-group">
              <span class="item-label">{{ t('settings.userDataDir') }}</span>
              <span class="item-hint">{{ t('settings.userDataDirHint') }}</span>
            </div>
            <span class="item-link" :title="dataDirState.current">
              {{ shortenPath(dataDirState.current) }}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </span>
          </div>
          <div v-if="dataDirState.isCustom" class="setting-item">
            <span class="item-label">{{ t('settings.resetDataDir') }}</span>
            <button class="text-btn" @click="resetDataDir">{{ t('settings.resetToDefault') }}</button>
          </div>
        </div>
      </div>

      <!-- 对话历史 -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.history') }}</div>
        <div class="group-content">
          <div class="setting-item">
            <div class="item-label-group">
              <span class="item-label">{{ t('settings.autoCleanHistory') }}</span>
              <span class="item-hint">{{ t('settings.autoCleanHistoryHint') }}</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" v-model="historyConfig.autoClean" @change="onAutoCleanToggle" />
              <span class="toggle-slider"></span>
            </label>
          </div>
          <div v-if="historyConfig.autoClean" class="setting-item">
            <span class="item-label">{{ t('settings.cleanBefore') }}</span>
            <div class="font-size-options">
              <div
                :class="['font-size-option', { active: historyConfig.cleanBefore === '1month' }]"
                @click="setCleanBefore('1month')"
              >{{ t('settings.clean1month') }}</div>
              <div
                :class="['font-size-option', { active: historyConfig.cleanBefore === '3months' }]"
                @click="setCleanBefore('3months')"
              >{{ t('settings.clean3months') }}</div>
              <div
                :class="['font-size-option', { active: historyConfig.cleanBefore === '6months' }]"
                @click="setCleanBefore('6months')"
              >{{ t('settings.clean6months') }}</div>
              <div
                :class="['font-size-option', { active: historyConfig.cleanBefore === '1year' }]"
                @click="setCleanBefore('1year')"
              >{{ t('settings.clean1year') }}</div>
            </div>
          </div>
          <div v-if="historyConfig.autoClean && historyConfig.lastCleanAt" class="setting-item">
            <span class="item-label">{{ t('settings.lastCleanTime') }}</span>
            <span class="item-link">{{ formatBackupTime(historyConfig.lastCleanAt) }}</span>
          </div>
        </div>
      </div>

      <!-- 知识库检索 (RAG) -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.rag') }}</div>
        <div class="group-content">
          <div class="setting-item">
            <span class="item-label">{{ t('settings.updateIndex') }}</span>
            <button
              class="primary-btn"
              :disabled="ragState.updating"
              @click="handleRagUpdate"
            >
              {{ ragState.updating ? t('settings.updating') : t('settings.updateIndex') }}
            </button>
          </div>
          <div v-if="ragState.progress || ragState.updating" class="setting-item rag-progress-item">
            <div class="rag-progress-content">
              <div class="rag-progress-main">
                <span class="item-label">{{ ragProgressMainLabel }}</span>
                <span class="item-link">{{ ragState.progress }}</span>
              </div>
              <div class="rag-progress-detail" v-if="ragState.fileName">
                <span class="rag-progress-file" :title="ragState.fileName">{{ ragState.fileName }}</span>
                <span class="rag-progress-meta" v-if="ragState.totalChunks > 0">· {{ ragState.currentChunk }}/{{ ragState.totalChunks }} {{ t('settings.chunks') }}</span>
                <span class="rag-progress-meta rag-progress-failed" v-if="ragState.failedCount > 0">· {{ t('settings.failed') }} {{ ragState.failedCount }}</span>
              </div>
            </div>
          </div>
          <div class="setting-item rag-stats-row">
            <span class="item-label">{{ t('settings.indexStats') }}</span>
            <div class="rag-stats-inline" v-if="ragStats && Object.keys(ragStats).length > 0">
              <span
                v-for="(stat, kbType) in ragStats"
                :key="kbType"
                class="rag-stat-chip"
                :class="{ 'has-issues': (stat.pending || 0) + (stat.failed || 0) > 0 }"
              >
                <span class="rag-stat-kb">{{ kbTypeLabel(kbType) }}</span>
                <span class="rag-stat-detail">{{ stat.success || 0 }}/{{ stat.total || 0 }}</span>
                <span class="rag-stat-vectors" v-if="stat.vectorCount">{{ stat.vectorCount }}v</span>
              </span>
            </div>
            <span v-else class="item-link">{{ t('settings.noData') }}</span>
          </div>
        </div>
      </div>

      <!-- 运行日志（Agent 运行观测） -->
      <div class="settings-group">
        <div class="group-title">{{ t('settings.runtimeLogs') }}</div>
        <div class="group-content">
          <div class="setting-item">
            <span class="item-label">{{ t('settings.runtimeLogsEnabled') }}</span>
            <div class="logs-actions">
              <button v-if="runtimeLogsEnabled" class="text-btn" @click="openLogDir">{{ t('settings.openLogDir') }}</button>
              <label class="toggle-switch">
                <input
                  type="checkbox"
                  v-model="runtimeLogsEnabled"
                  :aria-label="t('settings.runtimeLogsEnabled')"
                  @change="saveRuntimeLogsConfig"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- 通用提示弹窗（替代原生 alert/confirm） -->
    <Teleport to="body">
      <Transition name="appdlg-fade">
        <div v-if="dialog.visible" class="appdlg-overlay" @click.self="handleDialogCancel">
          <Transition name="appdlg-scale">
            <div v-if="dialog.visible" class="appdlg-card" :class="`is-${dialog.type}`" role="dialog" aria-modal="true">
              <div class="appdlg-icon">
                <svg v-if="dialog.type === 'success'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <svg v-else-if="dialog.type === 'error'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="15" y1="9" x2="9" y2="15"></line>
                  <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg>
                <svg v-else-if="dialog.type === 'warning'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <svg v-else-if="dialog.type === 'confirm'" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <svg v-else width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </div>
              <h3 class="appdlg-title">{{ dialogTitle }}</h3>
              <p v-if="dialog.message" class="appdlg-message">{{ dialog.message }}</p>
              <div v-if="dialog.details" class="appdlg-details">{{ dialog.details }}</div>
              <div class="appdlg-actions">
                <button v-if="dialog.type === 'confirm'" class="appdlg-btn appdlg-cancel" @click="handleDialogCancel">{{ dialog.cancelText }}</button>
                <button class="appdlg-btn appdlg-confirm" @click="handleDialogConfirm">{{ dialog.confirmText }}</button>
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { reactive, ref, computed, onMounted, onUnmounted, onDeactivated } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAppStore } from '@/store';
import { useTheme } from '@/utils/theme';
import { electronService } from '@/services/electron';
import { setI18nLanguage } from '@/i18n';
import { sidebarModuleConfig } from '@/config/menu';

const { t } = useI18n();
const router = useRouter();
const appStore = useAppStore();
const { currentMode, setTheme: applyTheme, initTheme } = useTheme();

const showThemeDropdown = ref(false);
const themeSelectRef = ref(null);
const showLangDropdown = ref(false);
const langSelectRef = ref(null);
let unsubBackupProgress = null;

const themeOptions = computed(() => [
  { value: 'light', label: t('settings.themeLight') },
  { value: 'dark', label: t('settings.themeDark') },
  { value: 'system', label: t('settings.themeSystem') }
]);

const langOptions = computed(() => [
  { value: 'zh-CN', label: t('settings.langZhCN') },
  { value: 'en-US', label: t('settings.langEnUS') }
]);

const currentLanguage = ref(appStore.language || 'zh-CN');

const fontSizeOptions = computed(() => [
  { value: 14, label: t('settings.fontSizeSmall') },
  { value: 16, label: t('settings.fontSizeStandard') },
  { value: 18, label: t('settings.fontSizeLarge') }
]);

const currentThemeLabel = computed(() => {
  const option = themeOptions.value.find(opt => opt.value === currentMode.value);
  return option?.label || t('settings.themeLight');
});

const currentLangLabel = computed(() => {
  const option = langOptions.value.find(opt => opt.value === currentLanguage.value);
  return option?.label || t('settings.langZhCN');
});

const settings = reactive({
  displayMode: currentMode,
  fontSize: 16,
  messageNotify: false,
  noteFimCompletion: appStore.noteFimCompletion,
  scheduleDefaultView: appStore.scheduleDefaultView || 'month',
  // 日程到期提醒：提前提醒分钟数 / 全天日程提醒时间
  reminderLeadMinutes: 60,
  reminderAllDayTime: '09:30'
});

const reminderLeadOptions = computed(() => [
  { value: 10, label: t('settings.reminderLead10') },
  { value: 30, label: t('settings.reminderLead30') },
  { value: 60, label: t('settings.reminderLead60') },
  { value: 120, label: t('settings.reminderLead120') }
]);

const enabledModuleCount = computed(() => Object.values(appStore.sidebarModules).filter(Boolean).length);
const sidebarModuleCount = sidebarModuleConfig.length;

const runtimeLogsEnabled = ref(true);
const noteExporting = ref(false);

// ========== 通用提示弹窗（替代原生 alert/confirm） ==========
const dialog = reactive({
  visible: false,
  type: 'info', // success | error | warning | info | confirm
  title: '',
  message: '',
  details: '',
  confirmText: '',
  cancelText: '',
  _resolve: null
});

const dialogTitle = computed(() => {
  if (dialog.title) return dialog.title;
  switch (dialog.type) {
    case 'success': return t('settings.dialogSuccessTitle');
    case 'error': return t('settings.dialogErrorTitle');
    case 'confirm': return t('settings.dialogConfirmTitle');
    case 'warning':
    case 'info':
    default: return t('settings.dialogWarningTitle');
  }
});

const showDialog = (options) => new Promise((resolve) => {
  Object.assign(dialog, {
    visible: true,
    type: options.type || 'info',
    title: options.title || '',
    message: options.message || '',
    details: options.details || '',
    confirmText: options.confirmText || t('settings.dialogConfirm'),
    cancelText: options.cancelText || t('settings.dialogCancel'),
    _resolve: resolve
  });
});

const closeDialog = (result) => {
  dialog.visible = false;
  const resolve = dialog._resolve;
  dialog._resolve = null;
  if (resolve) resolve(result);
};

const handleDialogConfirm = () => closeDialog(true);
const handleDialogCancel = () => closeDialog(false);

const notifySuccess = (message, options = {}) => showDialog({ ...options, type: 'success', message });
const notifyError = (message, options = {}) => showDialog({ ...options, type: 'error', message });
const notifyWarning = (message, options = {}) => showDialog({ ...options, type: 'warning', message });
const confirmDialog = (message, options = {}) => showDialog({
  ...options,
  type: 'confirm',
  message,
  confirmText: options.confirmText || t('settings.dialogConfirm'),
  cancelText: options.cancelText || t('settings.dialogCancel')
});

const handleExportAllNotes = async () => {
  if (noteExporting.value) return;
  noteExporting.value = true;
  try {
    const result = await electronService.invoke('export_all_notes');
    if (!result || result.canceled) return;
    if (result.success) {
      await notifySuccess(t('settings.exportNotesSuccess', { count: result.exported }), { details: result.exportDir });
    } else {
      const details = result.errors?.map(item => `${item.title}: ${item.error}`).join('\n');
      await notifyError(t('settings.exportNotesFailed', { exported: result.exported, total: result.total }), { details });
    }
  } catch (e) {
    await notifyError(t('settings.exportNotesFailed', { exported: 0, total: 0 }), { details: e.message || String(e) });
  } finally {
    noteExporting.value = false;
  }
};

// 备份状态
const backupState = reactive({
  backing: false,
  restoring: false
});

const backupConfig = reactive({
  enabled: false,
  interval: 'daily',
  lastBackupAt: null,
  autoDir: null,
  maxKeep: 7
});

// 对话历史自动清理配置（默认关闭，开启后按阈值清理长期未活动的会话）
const historyConfig = reactive({
  autoClean: false,
  cleanBefore: '3months',
  lastCleanAt: null
});

// 备份进度（由主进程 worker 推送的事件驱动）
const backupProgress = reactive({
  active: false,
  current: 0,
  total: 0,
  name: '',
  compressing: false
});

const backupProgressPercent = computed(() => {
  if (backupProgress.compressing) return 100;
  if (!backupProgress.total) return 0;
  return Math.min(100, Math.round((backupProgress.current / backupProgress.total) * 100));
});

const backupProgressLabel = computed(() => {
  if (backupProgress.compressing) return t('settings.backupCompressing');
  if (backupProgress.total > 0) {
    return `${t('settings.backupPacking')} ${backupProgress.current}/${backupProgress.total}`;
  }
  return t('settings.backing');
});

const handleBackupProgress = (p) => {
  if (!p) return;
  if (p.compressing) {
    backupProgress.compressing = true;
  } else {
    backupProgress.compressing = false;
    backupProgress.current = p.current || 0;
    backupProgress.total = p.total || 0;
    backupProgress.name = p.name || '';
  }
};

const loadBackupConfig = async () => {
  try {
    const cfg = await electronService.invoke('backup-get-config');
    if (cfg) {
      backupConfig.enabled = cfg.enabled || false;
      backupConfig.interval = cfg.interval || 'daily';
      backupConfig.lastBackupAt = cfg.lastBackupAt || null;
      backupConfig.autoDir = cfg.autoDir || null;
      backupConfig.maxKeep = cfg.maxKeep || 7;
    }
  } catch (e) {
    console.error('加载备份配置失败:', e);
  }
};

const saveBackupConfig = async () => {
  try {
    await electronService.invoke('backup-set-config', {
      enabled: backupConfig.enabled,
      interval: backupConfig.interval,
      autoDir: backupConfig.autoDir,
      maxKeep: backupConfig.maxKeep
    });
  } catch (e) {
    console.error('保存备份配置失败:', e);
  }
};

const setBackupInterval = (val) => {
  backupConfig.interval = val;
  saveBackupConfig();
};

const selectBackupDir = async () => {
  try {
    const result = await electronService.invoke('backup-select-dir');
    if (result.success && result.dir) {
      backupConfig.autoDir = result.dir;
      await saveBackupConfig();
    }
  } catch (e) {
    await notifyError(t('settings.selectDirFailed') + ': ' + e);
  }
};

const handleBackup = async () => {
  if (backupState.backing) return;
  backupState.backing = true;
  backupProgress.active = true;
  backupProgress.current = 0;
  backupProgress.total = 0;
  backupProgress.name = '';
  backupProgress.compressing = false;
  try {
    const result = await electronService.invoke('backup-create');
    if (result.success) {
      backupConfig.lastBackupAt = new Date().toISOString();
    } else if (!result.canceled) {
      await notifyError(t('settings.backupFailed') + ': ' + (result.error || t('settings.unknownError')));
    }
  } catch (e) {
    await notifyError(t('settings.backupFailed') + ': ' + e);
  } finally {
    backupState.backing = false;
    // 稍后隐藏进度条
    setTimeout(() => { backupProgress.active = false; }, 1200);
  }
};

const handleRestore = async () => {
  if (backupState.restoring) return;
  const go = await confirmDialog(t('settings.restoreConfirm'));
  if (!go) return;
  backupState.restoring = true;
  try {
    const result = await electronService.invoke('backup-restore');
    if (result.success) {
      await notifySuccess(t('settings.restoreSuccess'));
      window.location.reload();
    } else if (!result.canceled) {
      await notifyError(t('settings.restoreFailed') + ': ' + (result.error || t('settings.unknownError')));
    }
  } catch (e) {
    await notifyError(t('settings.restoreFailed') + ': ' + e);
  } finally {
    backupState.restoring = false;
  }
};

const shortenPath = (p) => {
  if (!p) return '';
  if (p.length <= 40) return p;
  return '...' + p.slice(-37);
};

const formatBackupTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ========== 数据存储 ==========
const dataDirState = reactive({
  current: '',
  isCustom: false,
  defaultDir: ''
});

const loadDataDirInfo = async () => {
  try {
    const info = await electronService.invoke('data-dir-get');
    if (info) {
      dataDirState.current = info.current || '';
      dataDirState.isCustom = !!info.isCustom;
      dataDirState.defaultDir = info.defaultDir || '';
    }
  } catch (e) {
    console.error('加载数据目录信息失败:', e);
  }
};

// 选择并切换数据目录：写指针 → 提示重启（可立即重启）
const selectDataDir = async () => {
  try {
    const picked = await electronService.invoke('data-dir-select');
    if (!picked.success) {
      if (!picked.canceled) await notifyError(t('settings.dataDirSelectFailed') + ': ' + (picked.error || t('settings.unknownError')));
      return;
    }
    if (picked.path === dataDirState.current) return;
    const confirmed = await confirmDialog(t('settings.dataDirChangeConfirm', { dir: picked.path }), {
      confirmText: t('settings.dialogConfirm'),
      cancelText: t('settings.dialogCancel')
    });
    if (!confirmed) return;
    const result = await electronService.invoke('data-dir-set', { dir: picked.path });
    if (!result.success) {
      await notifyError(t('settings.dataDirSetFailed') + ': ' + (result.error || t('settings.unknownError')));
      return;
    }
    if (!result.needRestart) {
      await notifyWarning(t('settings.dataDirSameAsCurrent'));
      return;
    }
    const restart = await showDialog({
      type: 'info',
      message: t('settings.dataDirRestartHint'),
      confirmText: t('settings.restartNow'),
      cancelText: t('settings.restartLater')
    });
    if (restart) await electronService.invoke('app-relaunch');
  } catch (e) {
    await notifyError(t('settings.dataDirSetFailed') + ': ' + e);
  }
};

// 恢复默认数据目录（数据保留在原自定义目录，重启后生效）
const resetDataDir = async () => {
  try {
    const confirmed = await confirmDialog(t('settings.dataDirResetConfirm'), {
      confirmText: t('settings.dialogConfirm'),
      cancelText: t('settings.dialogCancel')
    });
    if (!confirmed) return;
    const result = await electronService.invoke('data-dir-reset');
    if (!result.success) {
      await notifyError(t('settings.dataDirSetFailed') + ': ' + (result.error || t('settings.unknownError')));
      return;
    }
    if (!result.needRestart) return;
    const restart = await showDialog({
      type: 'info',
      message: t('settings.dataDirRestartHint'),
      confirmText: t('settings.restartNow'),
      cancelText: t('settings.restartLater')
    });
    if (restart) await electronService.invoke('app-relaunch');
  } catch (e) {
    await notifyError(t('settings.dataDirSetFailed') + ': ' + e);
  }
};


// ========== 对话历史自动清理 ==========
const loadHistoryConfig = async () => {
  try {
    const cfg = await electronService.invoke('history-get-config');
    if (cfg) {
      historyConfig.autoClean = cfg.autoClean || false;
      historyConfig.cleanBefore = cfg.cleanBefore || '3months';
      historyConfig.lastCleanAt = cfg.lastCleanAt || null;
    }
  } catch (e) {
    console.error('加载对话历史清理配置失败:', e);
  }
};

const saveHistoryConfig = async () => {
  try {
    const result = await electronService.invoke('history-set-config', {
      autoClean: historyConfig.autoClean,
      cleanBefore: historyConfig.cleanBefore
    });
    // 同步主进程回写的配置（含 lastCleanAt）
    if (result && result.history) {
      historyConfig.lastCleanAt = result.history.lastCleanAt || null;
    }
  } catch (e) {
    console.error('保存对话历史清理配置失败:', e);
  }
};

// 开关切换：保存配置；开启时立即执行一次清理（用户主动操作，不属于频繁扫描）
const onAutoCleanToggle = async () => {
  await saveHistoryConfig();
  if (!historyConfig.autoClean) return;
  try {
    const cleanResult = await electronService.invoke('history-clean-now');
    if (cleanResult && cleanResult.success && cleanResult.lastCleanAt) {
      historyConfig.lastCleanAt = cleanResult.lastCleanAt;
    }
  } catch (e) {
    console.error('立即清理对话历史失败:', e);
  }
};

const setCleanBefore = (val) => {
  historyConfig.cleanBefore = val;
  saveHistoryConfig();
};

// ========== Python 环境 ==========
const pythonState = reactive({
  loading: false,
  detecting: false,
  verifying: false,
  available: false,
  reason: '',
  configured: null,
  path: null,
  version: null,
  missingDeps: []
});

// 自动检测按钮：检测中或校验依赖中均禁用，标签随状态切换
const detectBusy = computed(() => pythonState.detecting || pythonState.verifying);
const detectBtnLabel = computed(() => {
  if (pythonState.verifying) return t('settings.pythonVerifying');
  if (pythonState.detecting) return t('settings.pythonDetecting');
  return t('settings.pythonAutoDetectBtn');
});

const loadPythonStatus = async () => {
  pythonState.loading = true;
  try {
    const st = await electronService.invoke('python-status');
    pythonState.available = !!st.available;
    pythonState.reason = st.reason || '';
    pythonState.configured = st.configured || null;
    pythonState.path = st.path || null;
    pythonState.version = st.version || null;
  } catch (e) {
    console.error('加载 Python 状态失败:', e);
  } finally {
    pythonState.loading = false;
  }
};

// 校验依赖：返回 { ok, missingDeps, error }。仅在 Python 可用时调用
const verifyPythonDepsInternal = async () => {
  if (!pythonState.available) {
    return { ok: false, skipped: true };
  }
  try {
    const result = await electronService.invoke('python-verify', { path: pythonState.path });
    if (result.ok) {
      pythonState.missingDeps = [];
      return { ok: true };
    }
    if (result.reason === 'missing_deps') {
      const missing = result.missingDeps || [];
      pythonState.missingDeps = missing;
      return { ok: false, missingDeps: missing };
    }
    return { ok: false, error: t('settings.pythonVerifyFail') };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};

// 自动检测 Python：检测成功后顺带校验基本依赖；未检测到则不校验
const autoDetectPython = async () => {
  if (detectBusy.value) return;
  pythonState.detecting = true;
  try {
    const result = await electronService.invoke('python-autodetect');
    if (!result.ok) {
      // 未检测到 Python，不校验依赖
      await notifyWarning(t('settings.pythonDetectFail'));
      return;
    }
    // 写回配置并刷新状态
    await electronService.invoke('python-set-path', { path: result.path });
    await loadPythonStatus();
    // Python 已就绪，继续校验基本依赖
    pythonState.detecting = false;
    pythonState.verifying = true;
    const depResult = await verifyPythonDepsInternal();
    if (depResult.ok) {
      await notifySuccess(t('settings.pythonDetectOkDepsOk'), { details: result.path });
    } else if (depResult.missingDeps && depResult.missingDeps.length) {
      await notifyWarning(t('settings.pythonDetectOkDepsMissing'), {
        details: `${t('settings.pythonMissingDeps')}（${depResult.missingDeps.length}）：${depResult.missingDeps.join(', ')}`
      });
    } else {
      await notifyWarning(t('settings.pythonDetectOkDepsFail'), { details: result.path });
    }
  } catch (e) {
    await notifyError(t('settings.pythonDetectFail') + ': ' + e);
  } finally {
    pythonState.detecting = false;
    pythonState.verifying = false;
  }
};

const selectPythonFile = async () => {
  try {
    const result = await electronService.invoke('python-select-file');
    if (!result.success) return;
    if (!result.ok) {
      const go = await confirmDialog(t('settings.pythonInvalidVersion'));
      if (!go) return;
    }
    await electronService.invoke('python-set-path', { path: result.path });
    await loadPythonStatus();
  } catch (e) {
    await notifyError(t('settings.pythonSelectFail') + ': ' + e);
  }
};

// ========== RAG 知识检索 ==========
const ragState = reactive({
  updating: false,
  progress: '',
  progressText: '',
  fileName: '',
  currentChunk: 0,
  totalChunks: 0,
  kbIndex: 0,
  kbCount: 0,
  current: 0,
  total: 0,
  failedCount: 0,
  phase: ''
});

const ragStats = ref({});

const KB_TYPE_LABELS = computed(() => ({
  personal: t('settings.kbPersonal'),
  local: t('settings.kbLocal')
}));

function kbTypeLabel(kbType) {
  return KB_TYPE_LABELS.value[kbType] || kbType;
}

// 进度主标签：知识库名称（第几个/共几个）
const ragProgressMainLabel = computed(() => {
  if (!ragState.progressText) return t('settings.preparing');
  const label = kbTypeLabel(ragState.progressText);
  if (ragState.kbCount > 0) {
    return `${label}（${ragState.kbIndex}/${ragState.kbCount}）`;
  }
  return label;
});

const loadRagStats = async () => {
  try {
    const result = await electronService.invoke('rag-get-kb-summary', {});
    if (result && result.success) {
      ragStats.value = result.summary || {};
    }
  } catch (e) {
    console.error('加载 RAG 统计失败:', e);
  }
};

const handleRagUpdate = async () => {
  if (ragState.updating) return;
  ragState.updating = true;
  ragState.progress = t('settings.preparing');
  ragState.progressText = '';
  ragState.fileName = '';
  ragState.currentChunk = 0;
  ragState.totalChunks = 0;
  ragState.kbIndex = 0;
  ragState.kbCount = 0;
  ragState.current = 0;
  ragState.total = 0;
  ragState.failedCount = 0;
  ragState.phase = 'preparing';

  // 监听进度事件（on 返回 unsubscribe 函数）
  let unsubProgress = null;
  let unsubDone = null;
  if (window.electronAPI) {
    unsubProgress = window.electronAPI.on('rag-update-progress', (progress) => {
      ragState.progressText = progress.kbType || '';
      ragState.kbIndex = progress.kbIndex || 0;
      ragState.kbCount = progress.kbCount || 0;

      switch (progress.phase) {
        case 'scanned':
          ragState.phase = 'scanned';
          ragState.total = progress.changedCount || 0;
          ragState.fileName = '';
          ragState.totalChunks = 0;
          if ((progress.changedCount || 0) === 0) {
            ragState.progress = t('settings.noChanges');
          } else {
            ragState.progress = `${t('settings.scanned')} ${progress.total || 0} · ${t('settings.pending')} ${progress.changedCount || 0}`;
          }
          break;
        case 'indexing':
          ragState.phase = 'indexing';
          ragState.current = progress.current || 0;
          ragState.total = progress.total || 0;
          ragState.fileName = progress.fileName || '';
          ragState.currentChunk = progress.currentChunk || 0;
          ragState.totalChunks = progress.totalChunks || 0;
          ragState.progress = `${progress.current || 0}/${progress.total || 0}`;
          break;
        case 'indexed':
          ragState.phase = 'indexed';
          ragState.current = progress.current || 0;
          ragState.total = progress.total || 0;
          ragState.fileName = progress.fileName || '';
          ragState.progress = `${progress.current || 0}/${progress.total || 0}`;
          break;
        case 'failed':
          ragState.phase = 'failed';
          ragState.failedCount = (ragState.failedCount || 0) + 1;
          ragState.current = progress.current || 0;
          ragState.total = progress.total || 0;
          ragState.fileName = progress.fileName || '';
          ragState.progress = `${progress.current || 0}/${progress.total || 0}`;
          break;
        case 'optimizing':
          ragState.phase = 'optimizing';
          ragState.fileName = '';
          ragState.totalChunks = 0;
          ragState.progress = t('settings.optimizing');
          break;
      }
    });
    unsubDone = window.electronAPI.on('rag-update-done', () => {
      if (unsubProgress) unsubProgress();
      if (unsubDone) unsubDone();
    });
  }

  try {
    const result = await electronService.invoke('rag-manual-update', {});
    if (result && result.success) {
      const failedTotal = Object.values(result.results || {}).reduce((s, r) => s + (r.failed || 0), 0);
      const changedTotal = Object.values(result.results || {}).reduce((s, r) => s + (r.changed || 0), 0);
      if (failedTotal > 0) {
        ragState.progress = `${t('settings.complete')} · ${t('settings.failed')}: ${failedTotal}/${changedTotal}`;
      } else if (changedTotal === 0) {
        ragState.progress = t('settings.noChanges');
      } else {
        ragState.progress = `${t('settings.complete')} · ${changedTotal}`;
      }
      ragState.phase = 'done';
      ragState.fileName = '';
      ragState.totalChunks = 0;
      await loadRagStats();
    } else {
      ragState.progress = t('settings.failed') + ': ' + (result?.error || t('settings.unknownError'));
      ragState.phase = 'error';
    }
  } catch (e) {
    ragState.progress = t('settings.failed') + ': ' + e.message;
    ragState.phase = 'error';
  } finally {
    ragState.updating = false;
    // 5 秒后清空进度
    setTimeout(() => {
      ragState.progress = '';
      ragState.progressText = '';
      ragState.fileName = '';
      ragState.phase = '';
      ragState.totalChunks = 0;
    }, 5000);
  }
};

const toggleThemeDropdown = () => {
  showThemeDropdown.value = !showThemeDropdown.value;
};

const selectTheme = async (value) => {
  settings.displayMode = value;
  applyTheme(value);
  appStore.setTheme(value);
  showThemeDropdown.value = false;
  // 持久化到 config.json，与 language 等设置保持一致。
  // 否则 config.theme 会一直停留在默认 'light'，后续 config-changed 广播时
  // 会用过期的 theme 覆盖用户当前主题（深色被强制切回浅色）。
  try {
    const config = await electronService.invoke('get-config');
    if (config) {
      config.theme = value;
      await electronService.invoke('save-config', config);
    }
  } catch (_e) {}
};

const toggleLangDropdown = () => {
  showLangDropdown.value = !showLangDropdown.value;
};

const selectLanguage = async (value) => {
  currentLanguage.value = value;
  appStore.setLanguage(value);
  setI18nLanguage(value);
  showLangDropdown.value = false;
  try {
    const config = await electronService.invoke('get-config');
    if (config) {
      config.language = value;
      await electronService.invoke('save-config', config);
    }
  } catch (_e) {}
};

const saveNoteFimCompletion = async () => {
  appStore.setNoteFimCompletion(settings.noteFimCompletion);
  try {
    const config = await electronService.invoke('get-config');
    if (config) {
      config.noteFimCompletion = settings.noteFimCompletion;
      await electronService.invoke('save-config', config);
    }
  } catch (_e) {}
};

const selectScheduleView = async (value) => {
  if (value !== 'week' && value !== 'month' && value !== 'quadrant') return;
  settings.scheduleDefaultView = value;
  appStore.setScheduleDefaultView(value);
  try {
    const config = await electronService.invoke('get-config');
    if (config) {
      config.scheduleDefaultView = value;
      await electronService.invoke('save-config', config);
    }
  } catch (_e) {}
};

// 日程到期提醒：提前提醒分钟 / 全天提醒时间，写入 config.json 供主进程调度器读取
const saveReminderConfig = async () => {
  try {
    const config = await electronService.invoke('get-config');
    if (!config) return;
    config.reminderLeadMinutes = settings.reminderLeadMinutes;
    const time = /^\d{1,2}:\d{2}$/.test(settings.reminderAllDayTime || '') ? settings.reminderAllDayTime : '09:30';
    config.reminderAllDayTime = time;
    await electronService.invoke('save-config', config);
  } catch (_e) {}
};

const selectReminderLead = async (value) => {
  if (![10, 30, 60, 120].includes(value)) return;
  settings.reminderLeadMinutes = value;
  await saveReminderConfig();
};

// 文件打开方式二级设置页（默认打开方式 + 系统文件关联）
const goToFileOpenSettings = () => {
  router.push('/settings/file-open');
};

const handleClickOutside = (event) => {
  if (themeSelectRef.value && !themeSelectRef.value.contains(event.target)) {
    showThemeDropdown.value = false;
  }
  if (langSelectRef.value && !langSelectRef.value.contains(event.target)) {
    showLangDropdown.value = false;
  }
};

// 弹窗快捷键：Enter 确认 / Esc 取消
const handleKeydown = (e) => {
  if (!dialog.visible) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    handleDialogCancel();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    handleDialogConfirm();
  }
};

const saveRuntimeLogsConfig = async () => {
  const nextValue = runtimeLogsEnabled.value;
  try {
    const config = await electronService.invoke('get-config');
    if (!config) throw new Error('Failed to load config');
    config.runtimeLogsEnabled = nextValue;
    const result = await electronService.invoke('save-config', config);
    if (result?.success === false) throw new Error(result.error || 'Failed to save config');
  } catch (e) {
    runtimeLogsEnabled.value = !nextValue;
    notifyError(e.message || t('settings.runtimeLogsSaveFailed'));
  }
};

// 打开运行日志所在目录（系统文件管理器）
const openLogDir = async () => {
  const res = await electronService.invoke('logs-open-dir');
  if (!res || res.success === false) {
    notifyError(res?.error || t('settings.openLogDirFailed'));
  }
};

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('keydown', handleKeydown);
  initTheme();
  settings.displayMode = currentMode.value;
  currentLanguage.value = appStore.language || 'zh-CN';
  electronService.invoke('get-config').then((config) => {
    if (config) {
      runtimeLogsEnabled.value = config.runtimeLogsEnabled !== false;
      appStore.setSidebarModules(config.sidebarModules);
      if (config.reminderLeadMinutes) settings.reminderLeadMinutes = config.reminderLeadMinutes;
      if (config.reminderAllDayTime) settings.reminderAllDayTime = config.reminderAllDayTime;
    }
  });
  loadBackupConfig();
  loadDataDirInfo();
  loadHistoryConfig();
  loadRagStats();
  loadPythonStatus();
  // 订阅备份进度事件（主进程 worker 推送）
  if (window.electronAPI) {
    unsubBackupProgress = window.electronAPI.on('backup-progress', handleBackupProgress);
  }
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('keydown', handleKeydown);
  if (unsubBackupProgress) unsubBackupProgress();
});

onDeactivated(() => {
  showThemeDropdown.value = false;
  showLangDropdown.value = false;
});

const goToModelSettings = () => {
  router.push('/settings/model');
};

const goToModuleSettings = () => {
  router.push('/settings/modules');
};

const goToBundleSettings = () => {
  router.push('/settings/bundles');
};
const goToFlywheelSettings = () => {
  router.push('/settings/flywheel');
};

</script>

<style scoped>
.settings-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 40px;
}

.settings-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 28px;
  max-width: 720px;
  width: 100%;
  text-align: left;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 720px;
  width: 100%;
}

.settings-group {
  background-color: var(--bg-primary);
}

.group-title {
  font-size: 14px;
  color: var(--text-tertiary);
  padding: 16px 0 10px;
  font-weight: 400;
}

.group-content {
  background-color: var(--bg-secondary);
  border-radius: 10px;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-color);
  min-height: 52px;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item.clickable {
  cursor: pointer;
}

.item-label {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.item-label-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-right: 16px;
}

.item-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 400;
  line-height: 1.4;
}

.theme-select-wrapper {
  position: relative;
  flex: 1;
  max-width: 140px;
}

.theme-select-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background-color: var(--bg-secondary);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.theme-select-trigger:hover {
  background-color: var(--bg-hover);
}

.theme-select-arrow {
  color: var(--text-tertiary);
  transition: transform 0.2s ease;
  flex-shrink: 0;
  margin-left: 8px;
}

.theme-select-arrow.expanded {
  transform: rotate(180deg);
}

.theme-dropdown-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
  padding: 6px;
  z-index: 100;
  animation: themeDropdownIn 0.2s ease;
}

@keyframes themeDropdownIn {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.theme-dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  cursor: pointer;
  border-radius: 10px;
  transition: background-color 0.15s;
  font-size: 14px;
  color: var(--text-primary);
}

.theme-dropdown-item:hover {
  background-color: var(--bg-hover);
}

.theme-dropdown-item.active {
  background-color: var(--accent-light);
}

.check-icon {
  flex-shrink: 0;
}

.font-size-options {
  display: flex;
  align-items: center;
  gap: 4px;
  background-color: var(--bg-secondary);
  border-radius: 8px;
  padding: 4px;
}

.font-size-option {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}

.font-size-option:hover {
  color: var(--text-primary);
  background-color: var(--bg-hover);
}

.font-size-option.active {
  background-color: var(--text-primary);
  color: var(--bg-primary);
  font-weight: 500;
}

.item-options {
  display: flex;
  align-items: center;
  gap: 4px;
  background-color: var(--bg-secondary);
  border-radius: 8px;
  padding: 4px;
}

.item-toggle {
  display: flex;
  align-items: center;
}

.item-toggle input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.text-input {
  width: 200px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
}

.text-input:focus {
  border-color: var(--text-tertiary);
}

/* 全天日程提醒时间选择 */
.reminder-time-input {
  width: 120px;
  height: 30px;
  font-family: inherit;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--text-tertiary);
  border-radius: 24px;
  transition: background-color 0.25s ease;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: var(--bg-primary);
  border-radius: 50%;
  transition: transform 0.25s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.toggle-switch input:checked + .toggle-slider {
  background-color: #10b981;
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(20px);
}

.item-link {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--text-tertiary);
}

.item-link svg {
  color: var(--text-tertiary);
}

.action-btn {
  background-color: var(--text-primary);
  color: var(--bg-primary);
  border: none;
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
  transition: opacity 0.15s;
}

.action-btn:hover {
  opacity: 0.85;
}

.arrow-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.text-btn {
  background-color: transparent;
  color: var(--text-primary);
  border: none;
  padding: 5px 14px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
}

.text-btn:hover {
  background-color: var(--bg-hover);
}

.primary-btn {
  background-color: var(--text-primary);
  color: var(--bg-primary);
  border: none;
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  font-weight: 500;
  font-family: inherit;
  transition: opacity 0.2s;
}

.primary-btn:hover {
  opacity: 0.85;
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* RAG 索引统计 - 紧凑内联 */
.rag-stats-row {
  border-bottom: none;
  align-items: flex-start;
  flex-wrap: wrap;
}

.rag-stats-inline {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.rag-stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-hover);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
  line-height: 1.4;
}

.rag-stat-kb {
  color: var(--text-tertiary);
  white-space: nowrap;
}

.rag-stat-detail {
  color: var(--text-primary);
  font-weight: 500;
  white-space: nowrap;
}

.rag-stat-vectors {
  color: var(--text-tertiary);
  font-size: 11px;
  white-space: nowrap;
}

.rag-stat-chip.has-issues .rag-stat-detail,
.rag-stat-chip.has-issues .rag-stat-vectors {
  color: #f59e0b;
}

/* RAG 索引进度 */
.rag-progress-item {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.rag-progress-content {
  width: 100%;
}

.rag-progress-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.rag-progress-detail {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.rag-progress-file {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.rag-progress-meta {
  white-space: nowrap;
  flex-shrink: 0;
}

.rag-progress-failed {
  color: #f59e0b;
}

[data-theme='dark'] .theme-dropdown-menu {
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
}

/* 运行日志 */
.logs-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 24px;
}

.logs-actions .text-btn {
  height: 24px;
  padding-top: 0;
  padding-bottom: 0;
  line-height: 24px;
}

/* Python 环境设置区块 */
.python-ok {
  color: #10b981;
  font-weight: 500;
}

.python-warn {
  color: #ef4444;
  font-weight: 500;
}

/* 备份进度条 */
.backup-progress-item {
  flex-direction: column;
  align-items: stretch;
  padding-top: 4px;
}

.backup-progress-content {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.backup-progress-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.backup-progress-bar {
  width: 100%;
  height: 6px;
  border-radius: 6px;
  background: var(--bg-hover);
  overflow: hidden;
}

.backup-progress-fill {
  height: 100%;
  border-radius: 6px;
  background: linear-gradient(90deg, #10b981, #34d399);
  transition: width 0.25s ease;
}

.backup-progress-file {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
}

/* 通用提示弹窗（替代原生 alert/confirm） */
.appdlg-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.appdlg-card {
  background: var(--bg-primary);
  border-radius: 18px;
  padding: 30px 30px 22px;
  width: 400px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.18),
    0 8px 24px rgba(0, 0, 0, 0.1),
    0 0 0 1px var(--border-color);
}

.appdlg-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-bottom: 2px;
}

.appdlg-card.is-success .appdlg-icon {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.16), rgba(16, 185, 129, 0.07));
  color: #10b981;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.12);
}

.appdlg-card.is-error .appdlg-icon {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.16), rgba(239, 68, 68, 0.07));
  color: #ef4444;
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.12);
}

.appdlg-card.is-warning .appdlg-icon,
.appdlg-card.is-confirm .appdlg-icon {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.16), rgba(245, 158, 11, 0.07));
  color: #f59e0b;
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.12);
}

.appdlg-card.is-info .appdlg-icon {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.16), rgba(59, 130, 246, 0.07));
  color: #3b82f6;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.12);
}

.appdlg-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
  margin: 0;
  letter-spacing: -0.01em;
}

.appdlg-message {
  font-size: 13.5px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.65;
  margin: 0;
  padding: 0 8px;
  word-break: break-word;
}

.appdlg-details {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg-hover);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
  max-height: 120px;
  overflow-y: auto;
  word-break: break-all;
  white-space: pre-wrap;
  font-family: inherit;
}

.appdlg-actions {
  display: flex;
  gap: 10px;
  width: 100%;
  margin-top: 6px;
}

.appdlg-btn {
  flex: 1;
  padding: 11px 0;
  border: none;
  border-radius: 11px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
  font-family: inherit;
}

.appdlg-cancel {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.appdlg-cancel:hover {
  background: var(--bg-active);
}

.appdlg-btn:active {
  transform: scale(0.97);
}

.appdlg-confirm {
  background: linear-gradient(135deg, #10b981, #059669);
  color: #ffffff;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.25);
}

.appdlg-confirm:hover {
  box-shadow: 0 6px 20px rgba(16, 185, 129, 0.35);
  transform: translateY(-1px);
}

.is-error .appdlg-confirm {
  background: linear-gradient(135deg, #ef4444, #dc2626);
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.25);
}
.is-error .appdlg-confirm:hover {
  box-shadow: 0 6px 20px rgba(239, 68, 68, 0.35);
}

.is-warning .appdlg-confirm {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.25);
}
.is-warning .appdlg-confirm:hover {
  box-shadow: 0 6px 20px rgba(245, 158, 11, 0.35);
}

.is-confirm .appdlg-confirm {
  background: linear-gradient(135deg, #3b82f6, #2563eb);
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.25);
}
.is-confirm .appdlg-confirm:hover {
  box-shadow: 0 6px 20px rgba(59, 130, 246, 0.35);
}

[data-theme='dark'] .appdlg-card {
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--border-color);
}

.appdlg-fade-enter-active,
.appdlg-fade-leave-active {
  transition: opacity 0.2s ease;
}
.appdlg-fade-enter-from,
.appdlg-fade-leave-to {
  opacity: 0;
}

.appdlg-scale-enter-active {
  transition: all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.appdlg-scale-leave-active {
  transition: all 0.16s ease;
}
.appdlg-scale-enter-from {
  opacity: 0;
  transform: scale(0.9) translateY(8px);
}
.appdlg-scale-leave-to {
  opacity: 0;
  transform: scale(0.95) translateY(4px);
}
</style>
