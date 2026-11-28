import { defineStore } from 'pinia'

const MODE_KEY = 'o-hino-chat-mode'
const THINK_KEY = 'o-hino-think-mode'
const SELECTED_MODEL_KEY = 'o-hino-selected-model'
const SELECTED_WORKSPACE_KEY = 'o-hino-selected-workspace'
const ARENA_MODELS_KEY = 'o-hino-arena-models'
const CREATE_TARGET_KEY = 'o-hino-create-target'
const HISTORY_WIDTH_KEY = 'o-hino-history-sidebar-width'
const HISTORY_SESSIONS_KEY = 'o-hino-history-sessions'
const DEFAULT_HISTORY_WIDTH = 240

function readStorage(key, fallback = '') {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {}
}

function loadCreateTarget() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CREATE_TARGET_KEY) || '{}')
    const value = typeof parsed.value === 'string' ? parsed.value : 'auto'
    return {
      value: ['auto', 'skill', 'tool', 'plugin', 'other'].includes(value) ? value : 'auto',
      manual: !!parsed.manual
    }
  } catch {
    return { value: 'auto', manual: false }
  }
}

function loadHistorySidebarWidth() {
  try {
    const savedWidth = Number(localStorage.getItem(HISTORY_WIDTH_KEY))
    return savedWidth >= 200 && savedWidth <= 400 ? savedWidth : DEFAULT_HISTORY_WIDTH
  } catch {
    return DEFAULT_HISTORY_WIDTH
  }
}

function loadCachedHistorySessions() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(HISTORY_SESSIONS_KEY) || '[]')
    return Array.isArray(cached) ? cached : []
  } catch {
    return []
  }
}

function clonePlain(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

export const useFridayStore = defineStore('friday', {
  state: () => ({
    mode: readStorage(MODE_KEY, 'agent'),
    createTarget: loadCreateTarget(),
    thinkMode: readStorage(THINK_KEY, 'fast'),
    modelId: readStorage(SELECTED_MODEL_KEY, ''),
    workspaceId: (() => {
      const saved = readStorage(SELECTED_WORKSPACE_KEY, 'none')
      return saved === 'default' ? 'none' : saved
    })(),
    pendingLaunches: {},
    streamingByTab: {},
    arenaModelIds: (() => {
      try {
        const value = JSON.parse(localStorage.getItem(ARENA_MODELS_KEY) || '[]')
        return Array.isArray(value) ? value.filter(id => typeof id === 'string').slice(0, 4) : []
      } catch {
        return []
      }
    })(),
    historySessions: loadCachedHistorySessions(),
    historySidebarWidth: loadHistorySidebarWidth()
  }),
  actions: {
    setMode(mode) {
      this.mode = mode
      writeStorage(MODE_KEY, mode)
    },
    setCreateTarget(value, manual = true) {
      const allowed = ['auto', 'skill', 'tool', 'plugin', 'other']
      const normalized = allowed.includes(value) ? value : 'auto'
      this.createTarget = { value: normalized, manual: !!manual }
      writeStorage(CREATE_TARGET_KEY, JSON.stringify(this.createTarget))
    },
    setThinkMode(thinkMode) {
      this.thinkMode = thinkMode
      writeStorage(THINK_KEY, thinkMode)
    },
    setModelId(modelId) {
      this.modelId = modelId
      writeStorage(SELECTED_MODEL_KEY, modelId)
    },
    setWorkspaceId(workspaceId) {
      this.workspaceId = workspaceId
      writeStorage(SELECTED_WORKSPACE_KEY, workspaceId)
    },
    setArenaModelIds(ids) {
      const normalized = Array.isArray(ids)
        ? ids.filter(id => typeof id === 'string').slice(0, 4)
        : []
      this.arenaModelIds = normalized
      writeStorage(ARENA_MODELS_KEY, JSON.stringify(normalized))
    },
    toggleArenaModelId(id) {
      const list = [...this.arenaModelIds]
      const index = list.indexOf(id)
      if (index >= 0) list.splice(index, 1)
      else if (list.length < 4) list.push(id)
      this.setArenaModelIds(list)
    },
    setPendingLaunch(tabId, payload) {
      const key = tabId || '_default'
      const plain = clonePlain(payload)
      this.pendingLaunches[key] = plain
      if (key !== '_default') this.pendingLaunches._default = plain
    },
    takePendingLaunch(tabId) {
      const keys = [...new Set([tabId, '_default'].filter(Boolean))]
      for (const key of keys) {
        if (this.pendingLaunches[key]) {
          const stored = this.pendingLaunches[key]
          Object.keys(this.pendingLaunches).forEach((item) => {
            if (this.pendingLaunches[item] === stored) delete this.pendingLaunches[item]
          })
          return clonePlain(stored)
        }
      }
      return null
    },
    setTabStreaming(tabId, streaming) {
      const key = tabId || '_default'
      if (streaming) this.streamingByTab[key] = true
      else delete this.streamingByTab[key]
    },
    isTabStreaming(tabId) {
      return !!this.streamingByTab[tabId || '_default']
    },
    setHistorySessions(sessions) {
      this.historySessions = Array.isArray(sessions) ? sessions : []
      try {
        sessionStorage.setItem(HISTORY_SESSIONS_KEY, JSON.stringify(this.historySessions))
      } catch {}
    },
    patchHistorySession(sessionId, patch) {
      const session = this.historySessions.find(item => item.id === sessionId)
      if (!session) return
      Object.assign(session, patch)
      this.setHistorySessions(this.historySessions)
    },
    removeHistorySession(sessionId) {
      this.setHistorySessions(this.historySessions.filter(item => item.id !== sessionId))
    },
    setHistorySidebarWidth(width) {
      this.historySidebarWidth = Math.min(400, Math.max(200, width))
    },
    persistHistorySidebarWidth() {
      writeStorage(HISTORY_WIDTH_KEY, String(this.historySidebarWidth))
    }
  }
})
