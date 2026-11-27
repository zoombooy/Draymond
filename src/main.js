import { createApp } from 'vue'
import { pinia } from './store'
import { router } from './router'
import { i18n } from './i18n'
import { renderScan } from './utils/render-scan'
import './assets/styles/main.css'
import App from './App.vue'

// 品牌从 happy-friday 改为 o-hino：一次性把旧 localStorage 键搬到新键，
// 只在目标键不存在时迁移，保留用户已有的模型/主题/会话等设置。旧键不删除，
// 以便回退到旧版本时仍可读取。
function migrateLegacyStorageKeys() {
  const legacyToNew = [
    ['happy-friday-selected-model', 'o-hino-selected-model'],
    ['happy-friday-custom-models', 'o-hino-custom-models'],
    ['happy-friday-theme-mode', 'o-hino-theme-mode'],
    ['happy-friday-chat-mode', 'o-hino-chat-mode'],
    ['happy-friday-think-mode', 'o-hino-think-mode'],
    ['happy-friday-history-sidebar-width', 'o-hino-history-sidebar-width'],
    ['happy-friday-history-sessions', 'o-hino-history-sessions'],
    ['happy-friday-recent-highlight-colors', 'o-hino-recent-highlight-colors'],
    ['happy-friday-kb-view-prefs', 'o-hino-kb-view-prefs']
  ]
  try {
    for (const [oldKey, newKey] of legacyToNew) {
      const oldValue = localStorage.getItem(oldKey)
      if (oldValue === null || localStorage.getItem(newKey) !== null) continue
      localStorage.setItem(newKey, oldValue)
    }
  } catch (error) {
    console.warn('[brand-migration] localStorage migration skipped:', error)
  }
}
migrateLegacyStorageKeys()

// The desktop app does not use Tab-based focus navigation.
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return
  // Note editor handles Tab for indentation and list nesting.
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('[contenteditable="true"]')) return
  event.preventDefault()
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
}, true)

const app = createApp(App)

app.use(pinia)
app.use(router)
app.use(i18n)

if (import.meta.env.DEV) {
  renderScan(app)
}

app.mount('#app')
