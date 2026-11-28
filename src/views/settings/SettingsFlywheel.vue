<template>
  <div class="flywheel-page">
    <button class="back-btn" :aria-label="t('note.back')" @click="goBack">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </button>

    <h1 class="page-title">{{ t('settings.flywheelTitle') }}</h1>
    <p class="page-desc">{{ t('settings.flywheelDesc') }}</p>

    <div class="flywheel-content">
      <!-- 诊断概览 -->
      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">{{ t('settings.flywheelDiagnosis') }}</h2>
          <button class="primary-btn" :disabled="isRefreshing" @click="refreshDiagnosis">
            {{ isRefreshing ? t('settings.flywheelRefreshing') : t('settings.flywheelRefresh') }}
          </button>
        </div>
        <div v-if="diagnosis" class="diagnosis-grid">
          <div class="stat-card">
            <div class="stat-value">{{ diagnosis.health?.length || 0 }}</div>
            <div class="stat-label">{{ t('settings.flywheelToolsTracked') }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ diagnosis.feedback?.copied || 0 }}</div>
            <div class="stat-label">{{ t('settings.flywheelPositive') }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ (diagnosis.feedback?.discarded || 0) + (diagnosis.feedback?.approvalRejected || 0) }}</div>
            <div class="stat-label">{{ t('settings.flywheelNegative') }}</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">{{ diagnosis.signals?.length || 0 }}</div>
            <div class="stat-label">{{ t('settings.flywheelSignals') }}</div>
          </div>
        </div>
        <div v-if="diagnosis?.signals?.length" class="signal-list">
          <div v-for="(signal, idx) in diagnosis.signals" :key="idx" class="signal-item">
            <span class="signal-tool">{{ signal.tool }}</span>
            <span class="signal-detail">{{ t('settings.flywheelSignalCount', { count: signal.count }) }}：{{ signal.details.join('；') }}</span>
          </div>
        </div>
        <p v-else class="empty-hint">{{ t('settings.flywheelNoSignals') }}</p>
      </section>

      <!-- 工具健康度表格 -->
      <section class="panel">
        <h2 class="panel-title">{{ t('settings.flywheelHealth') }}</h2>
        <div v-if="diagnosis?.health?.length" class="table-wrap">
          <table class="health-table">
            <thead>
              <tr>
                <th>{{ t('settings.flywheelTool') }}</th>
                <th>{{ t('settings.flywheelCalls') }}</th>
                <th>{{ t('settings.flywheelFailureRate') }}</th>
                <th>{{ t('settings.flywheelRetryRate') }}</th>
                <th>P95</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tool in diagnosis.health" :key="tool.toolName">
                <td class="tool-name">{{ tool.toolName }}</td>
                <td>{{ tool.calls }}</td>
                <td :class="{ warn: tool.failureRate >= 0.2 }">{{ (tool.failureRate * 100).toFixed(1) }}%</td>
                <td :class="{ warn: tool.retryRate >= 0.3 }">{{ (tool.retryRate * 100).toFixed(1) }}%</td>
                <td>{{ tool.p95DurationMs }}ms</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-hint">{{ t('settings.flywheelNoData') }}</p>
      </section>

      <!-- 发起优化 -->
      <section class="panel">
        <h2 class="panel-title">{{ t('settings.flywheelOptimize') }}</h2>
        <p class="panel-hint">{{ t('settings.flywheelOptimizeHint') }}</p>
        <div class="optimize-form">
          <label class="field-label" for="skill-select">{{ t('settings.flywheelTargetSkill') }}</label>
          <select id="skill-select" v-model="selectedSkill" class="skill-select">
            <option value="" disabled>{{ t('settings.flywheelSelectSkill') }}</option>
            <option v-for="skill in editableSkills" :key="skill.id" :value="skill.id">{{ skill.name }}</option>
          </select>
          <label class="checkbox-row">
            <input v-model="autoPromote" type="checkbox" />
            <span>{{ t('settings.flywheelAutoPromote') }}</span>
          </label>
          <button class="primary-btn" :disabled="isOptimizing || !selectedSkill" @click="startOptimization">
            {{ isOptimizing ? t('settings.flywheelOptimizing') : t('settings.flywheelRun') }}
          </button>
        </div>
        <p v-if="optimizeError" class="error-text">{{ optimizeError }}</p>
        <div v-if="lastResult" class="result-box">
          <div class="result-head">
            <span class="result-status" :class="statusClass(lastResult.status)">{{ statusLabel(lastResult) }}</span>
            <span class="result-time">{{ lastResult.createdAt }}</span>
          </div>
          <template v-if="lastResult.evaluation">
            <div class="eval-row">
              <span>{{ t('settings.flywheelBaselineRate') }}: {{ (lastResult.evaluation.baselineRate * 100).toFixed(0) }}%</span>
              <span>{{ t('settings.flywheelCandidateRate') }}: {{ (lastResult.evaluation.candidateRate * 100).toFixed(0) }}%</span>
              <span :class="lastResult.evaluation.delta >= 0 ? 'good' : 'warn'">Δ {{ (lastResult.evaluation.delta * 100).toFixed(0) }}%</span>
            </div>
          </template>
          <p v-if="lastResult.error" class="error-text">{{ lastResult.error }}</p>
          <div class="result-actions">
            <button v-if="lastResult.status === 'awaiting_promotion'" class="secondary-btn" @click="promoteRun(lastResult.id)">
              {{ t('settings.flywheelPromote') }}
            </button>
            <button v-if="lastResult.promoted && !lastResult.rolledBack" class="secondary-btn" @click="rollbackRun(lastResult.id)">
              {{ t('settings.flywheelRollback') }}
            </button>
          </div>
        </div>
      </section>

      <!-- 运行历史 -->
      <section class="panel">
        <h2 class="panel-title">{{ t('settings.flywheelHistory') }}</h2>
        <div v-if="runs.length" class="run-list">
          <div v-for="run in runs" :key="run.id" class="run-item" @click="selectRun(run)">
            <span class="run-skill">{{ run.skillId }}</span>
            <span class="run-status" :class="statusClass(run.status)">{{ statusText(run.status) }}</span>
            <span class="run-time">{{ run.createdAt?.slice(0, 19) }}</span>
          </div>
        </div>
        <p v-else class="empty-hint">{{ t('settings.flywheelNoRuns') }}</p>
      </section>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { electronService } from '@/services/electron'
import { loadModelConfig } from '@/views/friday/composables/useModelCatalog'
import { useFridayStore } from '@/store'

const { t } = useI18n()
const router = useRouter()
const fridayStore = useFridayStore()

const diagnosis = ref(null)
const runs = ref([])
const skills = ref([])
const selectedSkill = ref('')
const autoPromote = ref(true)
const isRefreshing = ref(false)
const isOptimizing = ref(false)
const optimizeError = ref('')
const lastResult = ref(null)

// 内置技能不允许自动改写（与后端 isBuiltinSkill 保持一致）
const BUILTIN = ['docx', 'marp-slide', 'pdf', 'pptx', 'skill-creator', 'xlsx']
const editableSkills = computed(() => skills.value.filter(s => !BUILTIN.includes(s.id)))

function goBack() {
  router.push('/settings')
}

async function refreshDiagnosis() {
  isRefreshing.value = true
  try {
    const res = await electronService.invoke('flywheel_diagnose')
    if (res?.success) diagnosis.value = res.data
  } finally {
    isRefreshing.value = false
  }
}

async function refreshRuns() {
  const res = await electronService.invoke('flywheel_list_runs', { limit: 50 })
  if (res?.success) runs.value = res.runs || []
}

async function refreshSkills() {
  try {
    const list = await electronService.invoke('agent-list-skills')
    skills.value = Array.isArray(list) ? list.map(s => ({ id: s.id || s.name || s.fileName?.replace(/\.md$/, ''), name: s.name || s.id })) : []
  } catch (_e) {
    skills.value = []
  }
}

async function startOptimization() {
  if (!selectedSkill.value) return
  isOptimizing.value = true
  optimizeError.value = ''
  lastResult.value = null
  try {
    const model = loadModelConfig(fridayStore.modelId)
    if (!model) {
      optimizeError.value = t('settings.flywheelNoModel')
      return
    }
    const res = await electronService.invoke('flywheel_optimize', {
      skillId: selectedSkill.value,
      model,
      autoPromote: autoPromote.value
    })
    if (!res?.success) {
      optimizeError.value = res?.error || t('settings.flywheelFailed')
      return
    }
    const detail = await electronService.invoke('flywheel_get_run', { runId: res.result?.runId })
    lastResult.value = detail?.run || null
    await refreshRuns()
    await refreshDiagnosis()
  } catch (e) {
    optimizeError.value = e?.message || t('settings.flywheelFailed')
  } finally {
    isOptimizing.value = false
  }
}

async function selectRun(run) {
  const detail = await electronService.invoke('flywheel_get_run', { runId: run.id })
  if (detail?.success) lastResult.value = detail.run
}

async function promoteRun(runId) {
  const res = await electronService.invoke('flywheel_promote', { runId })
  if (!res?.success) { optimizeError.value = res?.error || t('settings.flywheelFailed'); return }
  await selectRun({ id: runId })
  await refreshRuns()
}

async function rollbackRun(runId) {
  const res = await electronService.invoke('flywheel_rollback', { runId })
  if (!res?.success) { optimizeError.value = res?.error || t('settings.flywheelFailed'); return }
  await selectRun({ id: runId })
  await refreshRuns()
}

function statusClass(status) {
  if (status === 'promoted') return 'good'
  if (['failed', 'rejected', 'rolled_back'].includes(status)) return 'warn'
  return ''
}
function statusText(status) {
  const map = {
    diagnosing: t('settings.flywheelStDiagnosing'),
    diagnosed: t('settings.flywheelStDiagnosed'),
    candidate_ready: t('settings.flywheelStCandidate'),
    evaluated: t('settings.flywheelStEvaluated'),
    awaiting_promotion: t('settings.flywheelStAwaiting'),
    promoted: t('settings.flywheelStPromoted'),
    rejected: t('settings.flywheelStRejected'),
    rolled_back: t('settings.flywheelStRolledBack'),
    failed: t('settings.flywheelStFailed')
  }
  return map[status] || status
}
function statusLabel(run) {
  return statusText(run.status)
}

onMounted(async () => {
  await Promise.all([refreshDiagnosis(), refreshRuns(), refreshSkills()])
})
</script>

<style scoped>
.flywheel-page {
  padding: 32px 40px 60px;
  max-width: 1000px;
  margin: 0 auto;
  color: var(--text-primary);
}
.back-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  padding: 6px;
  margin-bottom: 16px;
  display: inline-flex;
  border-radius: 6px;
}
.back-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
.page-title { font-size: 24px; font-weight: 600; margin: 0 0 8px; }
.page-desc { font-size: 14px; color: var(--text-secondary); margin: 0 0 28px; line-height: 1.6; }
.flywheel-content { display: flex; flex-direction: column; gap: 20px; }
.panel {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 20px 22px;
}
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.panel-title { font-size: 16px; font-weight: 600; margin: 0 0 14px; }
.panel-head .panel-title { margin: 0; }
.panel-hint { font-size: 13px; color: var(--text-tertiary); margin: -6px 0 14px; }
.primary-btn, .secondary-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.primary-btn { background: #10b981; color: #fff; }
.secondary-btn { background: var(--bg-hover); color: var(--text-primary); border: 1px solid var(--border-color); }
.primary-btn:hover, .secondary-btn:hover { opacity: 0.85; }
.primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.diagnosis-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.stat-card {
  background: var(--bg-primary);
  border-radius: 10px;
  padding: 14px;
  text-align: center;
}
.stat-value { font-size: 24px; font-weight: 700; color: #10b981; }
.stat-label { font-size: 12px; color: var(--text-tertiary); margin-top: 4px; }
.signal-list { margin-top: 16px; display: flex; flex-direction: column; gap: 8px; }
.signal-item { font-size: 13px; line-height: 1.5; }
.signal-tool { display: inline-block; font-family: monospace; background: var(--bg-hover); padding: 2px 8px; border-radius: 4px; margin-right: 8px; }
.signal-detail { color: var(--text-secondary); }
.empty-hint { font-size: 13px; color: var(--text-tertiary); margin: 8px 0 0; }
.table-wrap { overflow-x: auto; }
.health-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.health-table th, .health-table td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border-color); }
.health-table th { color: var(--text-tertiary); font-weight: 500; }
.tool-name { font-family: monospace; }
.warn { color: #f59e0b; font-weight: 600; }
.good { color: #10b981; font-weight: 600; }
.optimize-form { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.field-label { font-size: 13px; color: var(--text-secondary); }
.skill-select {
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  min-width: 240px;
}
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-secondary); cursor: pointer; }
.error-text { font-size: 13px; color: #ef4444; margin: 10px 0 0; }
.result-box {
  margin-top: 16px;
  background: var(--bg-primary);
  border-radius: 10px;
  padding: 14px 16px;
}
.result-head { display: flex; justify-content: space-between; align-items: center; }
.result-status { font-weight: 600; font-size: 13px; }
.result-time { font-size: 12px; color: var(--text-tertiary); }
.eval-row { display: flex; gap: 20px; font-size: 13px; margin-top: 12px; }
.result-actions { display: flex; gap: 10px; margin-top: 14px; }
.run-list { display: flex; flex-direction: column; gap: 6px; }
.run-item {
  display: flex; align-items: center; gap: 14px;
  padding: 10px 12px; border-radius: 8px; cursor: pointer;
  background: var(--bg-primary); font-size: 13px;
}
.run-item:hover { background: var(--bg-hover); }
.run-skill { font-family: monospace; flex: 1; }
.run-status { font-weight: 600; }
.run-time { color: var(--text-tertiary); font-size: 12px; }
@media (max-width: 700px) {
  .flywheel-page { padding: 20px 16px 40px; }
  .diagnosis-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
