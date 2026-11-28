<template>
  <div class="friday-composer" :class="`is-${variant}`" @click="closeAllDropdowns">
    <!-- 工作区 / 工作模式选择条（截图4风格） -->
    <div class="composer-context-bar">
      <button class="context-btn" type="button" @click.stop="toggleDropdown('workspace', $event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <span>{{ workspaceLabel }}</span>
        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
      <button class="context-btn" type="button" @click.stop="toggleDropdown('mode', $event)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        <span>{{ currentModeLabel }}</span>
        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
    </div>

    <ChatInputBox
      :model-value="modelBinding ? undefined : modelValue"
      :model-binding="modelBinding"
      @update:model-value="handleInputUpdate"
      :placeholder="placeholder || t('friday.placeholder')"
      :is-streaming="isStreaming"
      :attachments="attachments"
      :show-reference-buttons="false"
      :dropdown-direction="variant === 'conversation' ? 'up' : 'down'"
      @send="handleSend"
      @stop="$emit('stop')"
    >
      <template #actions-left>
        <!-- 加号菜单：附件/图片/知识库/工具/技能/MCP -->
        <button class="action-btn plus-btn" type="button" :title="t('friday.addAttachment')" @click.stop="toggleDropdown('plus', $event)">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button class="action-btn dropdown-btn model-trigger" type="button" @click.stop="toggleDropdown('model', $event)">
          <img :src="currentModelIcon" class="trigger-model-icon" alt="" />
          <span>{{ currentModelName }}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </template>
    </ChatInputBox>

    <Teleport to="body">
      <!-- 工作区下拉 -->
      <div v-if="showWorkspaceDropdown" class="dropdown-overlay" :style="workspaceDropdownStyle" @click.stop>
        <div class="dropdown-panel workspace-dropdown">
          <div class="panel-title">{{ t('friday.workspace') }}</div>
          <div
            v-for="ws in workspaces"
            :key="ws.id"
            class="dropdown-item workspace-item"
            :class="{ active: selectedWorkspaceId === ws.id }"
            @click="selectWorkspace(ws.id)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span class="workspace-item-name">{{ ws.name }}</span>
            <span v-if="ws.path" class="workspace-item-path" :title="ws.path">{{ ws.path }}</span>
            <svg v-if="selectedWorkspaceId === ws.id" class="item-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <button v-if="!ws.builtin" class="workspace-del" type="button" :title="t('friday.remove')" @click.stop="removeWorkspaceItem(ws.id)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
          <div class="workspace-create" @click="startCreateWorkspace">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>{{ t('friday.newWorkspace') }}</span>
          </div>
        </div>
      </div>

      <!-- 模式下拉 -->
      <div v-if="showModeDropdown" class="dropdown-overlay" :style="modeDropdownStyle" @click.stop>
        <div class="dropdown-panel mode-dropdown">
          <div
            v-for="mode in chatModes"
            :key="mode.value"
            class="dropdown-item"
            :class="{ active: fridayStore.mode === mode.value }"
            @click="selectMode(mode.value)"
          >
            {{ t(`friday.${mode.i18n}`) }}
          </div>
        </div>
      </div>

      <!-- 加号菜单 -->
      <div v-if="showPlusDropdown" class="dropdown-overlay" :style="plusDropdownStyle" @click.stop>
        <div class="dropdown-panel plus-dropdown">
          <div class="plus-menu-item" @click="uploadFiles(false)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
            <span>{{ t('friday.addAttachment') }}</span>
          </div>
          <div class="plus-menu-item" @click="uploadFiles(true)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
            <span>{{ t('friday.uploadImage') }}</span>
          </div>
          <div class="plus-menu-sep"></div>
          <div class="plus-menu-item has-sub" @mouseenter="activeSub = 'kb'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
            <span>{{ t('friday.selectKnowledge') }}</span>
            <svg class="sub-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <div class="plus-menu-item has-sub" @mouseenter="activeSub = 'tool'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
            <span>{{ t('friday.selectTool') }}</span>
            <svg class="sub-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <div class="plus-menu-item has-sub" @mouseenter="activeSub = 'skill'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.4 6.9L21 12l-6.6 3.1L12 22l-2.4-6.9L3 12l6.6-3.1L12 2z"></path></svg>
            <span>{{ t('friday.selectSkill') }}</span>
            <svg class="sub-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>
          <div class="plus-menu-item has-sub" @mouseenter="activeSub = 'mcp'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v7M12 15v7M2 12h7M15 12h7"></path></svg>
            <span>{{ t('friday.selectMcp') }}</span>
            <svg class="sub-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </div>

          <!-- 二级菜单 -->
          <div v-if="activeSub" class="plus-sub-panel" @mouseenter="activeSub = activeSub" @mouseleave="activeSub = null">
            <template v-if="activeSub === 'kb'">
              <div class="sub-title">{{ t('friday.selectKnowledge') }}</div>
              <div v-if="!selectableKbList || selectableKbList.length === 0" class="sub-empty">{{ t('friday.kbEmpty') }}</div>
              <template v-else>
                <div class="sub-item" @click="handleSelectKb({ name: t('friday.allKb'), categoryId: null })">{{ t('friday.allKb') }}</div>
                <template v-for="category in selectableKbList" :key="category.id">
                  <div v-for="item in category.items" :key="item.id" class="sub-item" @click="handleSelectKb({ name: item.name, categoryId: category.id })">{{ item.name }}</div>
                </template>
              </template>
            </template>
            <template v-else-if="activeSub === 'tool'">
              <div class="sub-title">{{ t('friday.selectTool') }}</div>
              <div v-if="!toolList.length" class="sub-empty">—</div>
              <div v-for="tool in toolList" :key="tool.name" class="sub-item" :title="tool.description" @click="mentionItem(tool.name)">{{ tool.name }}</div>
            </template>
            <template v-else-if="activeSub === 'skill'">
              <div class="sub-title">{{ t('friday.selectSkill') }}</div>
              <div v-if="!skillList.length" class="sub-empty">—</div>
              <div v-for="skill in skillList" :key="skill.id" class="sub-item" :title="skill.description" @click="mentionItem(skill.name)">{{ skill.name }}</div>
            </template>
            <template v-else-if="activeSub === 'mcp'">
              <div class="sub-title">{{ t('friday.selectMcp') }}</div>
              <div v-if="!mcpList.length" class="sub-empty">—</div>
              <div v-for="mcp in mcpList" :key="mcp.name || mcp.id" class="sub-item" @click="mentionItem(mcp.name || mcp.id)">{{ mcp.name || mcp.id }}</div>
            </template>
          </div>
        </div>
      </div>

      <!-- 模型下拉（可搜索、分组、能力角标、上下文长度） -->
      <div v-if="showModelDropdown" class="dropdown-overlay" :style="modelDropdownStyle" @click.stop>
        <div class="dropdown-panel model-dropdown">
          <div class="model-search-row">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input v-model="modelSearch" class="model-search-input" type="text" :placeholder="t('friday.searchModel')" @click.stop />
          </div>
          <div class="model-row model-think-row">
            <span class="model-label">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              {{ t('friday.thinkMode') }}
            </span>
            <div class="think-tabs">
              <button class="think-tab" :class="{ active: fridayStore.thinkMode === 'fast' }" type="button" @click="fridayStore.setThinkMode('fast')">{{ t('friday.thinkFast') }}</button>
              <button class="think-tab" :class="{ active: fridayStore.thinkMode === 'deep' }" type="button" @click="fridayStore.setThinkMode('deep')">{{ t('friday.thinkDeep') }}</button>
            </div>
          </div>
          <div class="model-model-list">
            <template v-for="group in groupedModels" :key="group.label">
              <div class="model-group-label">{{ group.label }}</div>
              <div
                v-for="model in group.models"
                :key="model.id"
                class="model-item"
                :class="{ active: fridayStore.modelId === model.id }"
                @click="selectModel(model.id)"
              >
                <img :src="model.icon" class="model-icon" alt="" />
                <div class="model-info">
                  <div class="model-name-line">
                    <span class="model-name">{{ model.modelName }}</span>
                    <span v-if="model.contextLabel" class="model-ctx">{{ model.contextLabel }}</span>
                  </div>
                  <div class="model-badges">
                    <span v-if="model.capabilities.vision" class="cap-badge cap-vision">{{ t('friday.capVision') }}</span>
                    <span v-if="model.capabilities.reasoning" class="cap-badge cap-reasoning">{{ t('friday.capReasoning') }}</span>
                    <span v-if="model.capabilities.tools" class="cap-badge cap-tools">{{ t('friday.capTools') }}</span>
                    <span v-if="model.capabilities.code" class="cap-badge cap-code">{{ t('friday.capCode') }}</span>
                    <span v-if="model.embeddingName" class="cap-badge cap-embedding">{{ t('friday.embedding') }}</span>
                  </div>
                </div>
                <svg v-if="fridayStore.modelId === model.id" class="model-check" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </template>
            <div v-if="groupedModels.length === 0" class="model-empty">{{ t('friday.selectModel') }}</div>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 新建工作区对话框 -->
    <div v-if="showWorkspaceDialog" class="ws-dialog-mask" @click.stop="showWorkspaceDialog = false">
      <div class="ws-dialog" @click.stop>
        <div class="ws-dialog-title">{{ t('friday.newWorkspace') }}</div>
        <label class="ws-dialog-label">{{ t('friday.workspaceName') }}</label>
        <input v-model="newWorkspaceName" class="ws-dialog-input" type="text" :placeholder="t('friday.workspaceName')" />
        <label class="ws-dialog-label">{{ t('friday.workspacePath') }}</label>
        <div class="ws-dialog-path">
          <input v-model="newWorkspacePath" class="ws-dialog-input" type="text" :placeholder="t('friday.workspaceHint')" />
          <button class="ws-dialog-browse" type="button" @click="browseWorkspacePath">…</button>
        </div>
        <div class="ws-dialog-actions">
          <button class="ws-dialog-btn" type="button" @click="showWorkspaceDialog = false">{{ t('friday.workspaceCancel') }}</button>
          <button class="ws-dialog-btn primary" type="button" @click="createWorkspace">{{ t('friday.workspaceCreate') }}</button>
        </div>
      </div>
    </div>

    <SelectNoteDialog
      :visible="showNoteDialog"
      @close="showNoteDialog = false"
      @confirm="handleNoteConfirm"
    />

    <KbFileDialog
      :visible="showKbFileDialog"
      :selectable-kb-list="selectableKbList"
      @close="showKbFileDialog = false"
      @select="selectKbFile"
    />
  </div>
</template>

<script setup>
import { computed, onActivated, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ChatInputBox from '@/components/chat/ChatInputBox.vue';
import SelectNoteDialog from '@/views/knowledge/components/SelectNoteDialog.vue';
import KbFileDialog from '@/views/knowledge/components/KbFileDialog.vue';
import { useFridayStore } from '@/store';
import { useKnowledgeBaseList } from '@/views/friday/composables/useKnowledgeBaseList';
import { useModelCatalog } from '@/views/friday/composables/useModelCatalog';
import { useWorkspaces } from '@/views/friday/composables/useWorkspaces';
import { CHAT_MODES, providerIcons } from '@/views/friday/constants';
import { electronService } from '@/services/electron';

const props = defineProps({
  modelValue: { type: String, default: '' },
  // 可选绑定对象 { ref }：父级传入后，输入文本由该 ref 承载，父模板不读取其值，避免逐字符重渲染
  modelBinding: { type: Object, default: null },
  isStreaming: { type: Boolean, default: false },
  placeholder: { type: String, default: '' },
  variant: { type: String, default: 'conversation' }
});

const emit = defineEmits(['update:modelValue', 'send', 'stop']);

const { t } = useI18n();
const fridayStore = useFridayStore();
const { selectableKbList, loadKbListFromDisk } = useKnowledgeBaseList();
const { customModels, modelList, loadCustomModels } = useModelCatalog();
const {
  workspaces,
  selectedId: selectedWorkspaceId,
  selectedWorkspace,
  selectWorkspace: selectWorkspaceById,
  addWorkspace,
  removeWorkspace,
  reload: reloadWorkspaces
} = useWorkspaces();

const inputText = computed(() => {
  if (props.modelBinding) return props.modelBinding.ref.value || '';
  return props.modelValue || '';
});

// 非绑定模式下仍保持 v-model 兼容（FridayHome 等旧用法）
function handleInputUpdate(value) {
  if (!props.modelBinding) emit('update:modelValue', value);
}

const attachments = ref([]);
let attachmentIdCounter = 0;
const showNoteDialog = ref(false);
const showKbFileDialog = ref(false);
const showModeDropdown = ref(false);
const showModelDropdown = ref(false);
const showWorkspaceDropdown = ref(false);
const showPlusDropdown = ref(false);
const modeDropdownStyle = ref({});
const modelDropdownStyle = ref({});
const workspaceDropdownStyle = ref({});
const plusDropdownStyle = ref({});
const modelSearch = ref('');
const activeSub = ref(null);

const toolList = ref([]);
const skillList = ref([]);
const mcpList = ref([]);

const chatModes = computed(() => CHAT_MODES);

const currentModeLabel = computed(() => {
  const mode = CHAT_MODES.find(item => item.value === fridayStore.mode);
  return mode ? t(`friday.${mode.i18n}`) : t('friday.modeChat');
});

const currentModel = computed(() => customModels.value.find(item => item.id === fridayStore.modelId) || null);
const currentModelName = computed(() => {
  if (!currentModel.value) return t('friday.selectModel');
  const thinkLabel = fridayStore.thinkMode === 'deep' ? `· ${t('friday.thinkDeep')}` : `· ${t('friday.thinkFast')}`;
  return `${currentModel.value.modelName} ${thinkLabel}`;
});
const currentModelIcon = computed(() => {
  if (!currentModel.value) return providerIcons.other;
  return providerIcons[currentModel.value.provider] || providerIcons.other;
});

const workspaceLabel = computed(() => selectedWorkspace.value?.name || t('friday.defaultWorkspace'));

const groupedModels = computed(() => {
  const keyword = modelSearch.value.trim().toLowerCase();
  const matched = modelList.value.filter(model => {
    if (!keyword) return true;
    return [model.name, model.modelName, model.providerLabel, model.provider].some(value =>
      String(value || '').toLowerCase().includes(keyword)
    );
  });
  const groups = new Map();
  for (const model of matched) {
    const label = model.providerLabel || t('friday.selectModel');
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(model);
  }
  return [...groups.entries()].map(([label, models]) => ({ label, models }));
});

function closeAllDropdowns() {
  showModeDropdown.value = false;
  showModelDropdown.value = false;
  showWorkspaceDropdown.value = false;
  showPlusDropdown.value = false;
  activeSub.value = null;
}

function toggleDropdown(name, event) {
  const refs = {
    mode: [showModeDropdown, modeDropdownStyle],
    model: [showModelDropdown, modelDropdownStyle],
    workspace: [showWorkspaceDropdown, workspaceDropdownStyle],
    plus: [showPlusDropdown, plusDropdownStyle]
  };
  const entry = refs[name];
  if (!entry) return;
  const [showRef, styleRef] = entry;
  const wasOpen = showRef.value;
  closeAllDropdowns();
  if (wasOpen) return;
  if (name === 'plus') {
    loadPlusSources();
    activeSub.value = null;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  showRef.value = true;
  if (props.variant === 'conversation') {
    styleRef.value = {
      position: 'fixed',
      bottom: `${window.innerHeight - rect.top + 8}px`,
      left: `${rect.left}px`,
      zIndex: '9999'
    };
  } else {
    styleRef.value = {
      position: 'fixed',
      top: `${rect.bottom + 8}px`,
      left: `${rect.left}px`,
      zIndex: '9999'
    };
  }
}

function selectMode(mode) {
  fridayStore.setMode(mode);
  showModeDropdown.value = false;
}

function selectModel(modelId) {
  fridayStore.setModelId(modelId);
  showModelDropdown.value = false;
}

function selectWorkspace(id) {
  if (selectWorkspaceById(id)) {
    fridayStore.setWorkspaceId(id);
    showWorkspaceDropdown.value = false;
  }
}

function removeWorkspaceItem(id) {
  if (removeWorkspace(id)) {
    fridayStore.setWorkspaceId(selectedWorkspaceId.value);
  }
}

// ---------- 工作区新建 ----------
const showWorkspaceDialog = ref(false);
const newWorkspaceName = ref('');
const newWorkspacePath = ref('');

function startCreateWorkspace() {
  showWorkspaceDropdown.value = false;
  newWorkspaceName.value = '';
  newWorkspacePath.value = '';
  showWorkspaceDialog.value = true;
}

async function browseWorkspacePath() {
  const result = await electronService.invoke('open-file-dialog', {
    properties: ['openDirectory', 'createDirectory']
  });
  if (result) newWorkspacePath.value = Array.isArray(result) ? result[0] : result;
}

function createWorkspace() {
  const created = addWorkspace({ name: newWorkspaceName.value, path: newWorkspacePath.value });
  if (!created) return;
  fridayStore.setWorkspaceId(created.id);
  selectWorkspaceById(created.id);
  showWorkspaceDialog.value = false;
}

// ---------- 加号菜单数据源 ----------
async function loadPlusSources() {
  try {
    const [tools, skills, mcps] = await Promise.all([
      electronService.invoke('agent-list-tools'),
      electronService.invoke('agent-list-skills'),
      electronService.invoke('mcp-list-servers')
    ]);
    toolList.value = Array.isArray(tools) ? tools : [];
    skillList.value = Array.isArray(skills) ? skills : [];
    mcpList.value = Array.isArray(mcps) ? mcps : [];
  } catch (error) {
    console.error('Failed to load composer sources:', error);
  }
}

async function uploadFiles(imageOnly) {
  showPlusDropdown.value = false;
  const filters = imageOnly
    ? [{ name: t('friday.uploadImage'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
    : [];
  const paths = await electronService.invoke('open-file-dialog', {
    properties: ['openFile', 'multiSelections'],
    filters
  });
  if (!paths) return;
  const list = Array.isArray(paths) ? paths : [paths];
  for (const filePath of list) {
    const name = filePath.split(/[\\/]/).pop() || filePath;
    const isImage = imageOnly || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
    attachments.value.push({
      id: ++attachmentIdCounter,
      type: isImage ? 'image' : 'file',
      typeLabel: isImage ? t('friday.tagImage') : t('friday.tagFile'),
      name,
      path: filePath
    });
  }
}

function mentionItem(name) {
  showPlusDropdown.value = false;
  if (!name) return;
  const token = `@${name} `;
  const next = `${inputText.value}${inputText.value ? ' ' : ''}${token}`;
  if (props.modelBinding) {
    props.modelBinding.ref.value = next;
  } else {
    emit('update:modelValue', next);
  }
}

function openNoteSelect() {
  showNoteDialog.value = true;
}

function openKbFileSelect() {
  showKbFileDialog.value = true;
}

function handleSelectKb({ name, categoryId }) {
  attachments.value.push({
    id: ++attachmentIdCounter,
    type: 'kb',
    typeLabel: t('friday.tagKb'),
    name,
    categoryId: categoryId ?? null
  });
  showPlusDropdown.value = false;
}

function handleNoteConfirm(selectedNotes) {
  if (!selectedNotes?.length) return;
  for (const note of selectedNotes) {
    attachments.value.push({
      id: ++attachmentIdCounter,
      type: 'note',
      typeLabel: t('friday.tagNote'),
      name: note.title || t('friday.untitledNote'),
      noteId: note.id,
      content: note.contentText || ''
    });
  }
  showNoteDialog.value = false;
}

function selectKbFile(file) {
  attachments.value.push({
    id: ++attachmentIdCounter,
    type: 'kb-file',
    typeLabel: t('friday.tagFile'),
    name: file.name,
    path: file.path
  });
  showKbFileDialog.value = false;
}

function removeAttachment(idx) {
  attachments.value.splice(idx, 1);
}

function buildAttachmentData(text) {
  const noteAttachments = attachments.value.filter(item => item.type === 'note');
  const fileAttachments = attachments.value.filter(item => item.type === 'file' || item.type === 'kb-file' || item.type === 'image');
  if (!noteAttachments.length && !fileAttachments.length) return null;

  const refLines = [
    ...noteAttachments.map(note => `${t('friday.refNote')}${note.name}`),
    ...fileAttachments.map(file => `${t('friday.refDoc')}${file.name}`)
  ];

  return {
    userMessage: `${text}\n\n---\n${refLines.join('\n')}`,
    attachments: [
      ...noteAttachments.map(note => ({ kind: 'note', name: note.name, noteId: note.noteId })),
      ...fileAttachments.map(file => ({ kind: 'file', name: file.name, path: file.path }))
    ]
  };
}

function handleSend() {
  const text = inputText.value.trim();
  if (!text || props.isStreaming) return;
  const attData = buildAttachmentData(text);
  const kbAttachment = attachments.value.find(item => item.type === 'kb');
  const workspace = selectedWorkspace.value;
  emit('send', {
    text,
    userMessage: attData?.userMessage || text,
    attachments: attData?.attachments || [],
    kbName: kbAttachment?.name || '',
    kbCategoryId: kbAttachment?.categoryId || '',
    mode: fridayStore.mode,
    modelId: fridayStore.modelId,
    thinkMode: fridayStore.thinkMode,
    workspaceId: workspace?.id || 'default',
    workspaceName: workspace?.name || t('friday.defaultWorkspace'),
    folderPath: workspace?.path || ''
  });
  attachments.value = [];
}

watch(() => fridayStore.mode, (mode) => {
  if (mode === 'agent') {
    attachments.value = attachments.value.filter(item => item.type !== 'kb');
  }
});

watch(selectedWorkspaceId, (id) => {
  if (id && fridayStore.workspaceId !== id) fridayStore.setWorkspaceId(id);
}, { immediate: true });

onMounted(() => {
  loadCustomModels();
  loadKbListFromDisk();
  reloadWorkspaces();
  if (fridayStore.workspaceId && workspaces.value.some(item => item.id === fridayStore.workspaceId)) {
    selectWorkspaceById(fridayStore.workspaceId);
  }
});

onActivated(() => {
  loadCustomModels();
  reloadWorkspaces();
});

onDeactivated(closeAllDropdowns);
</script>

<style scoped>
.friday-composer.is-home :deep(.chat-input-box) {
  padding: 0;
}

.friday-composer.is-home :deep(.input-wrapper) {
  max-width: 750px;
  border-radius: 28px;
}

/* Conversation input follows the same fluid content width as the message list. */
.friday-composer.is-conversation :deep(.input-wrapper) {
  width: 100%;
  max-width: 900px;
}

.friday-composer.is-home :deep(.main-input) {
  padding: 18px 28px 6px;
  font-size: 16px;
  min-height: 52px;
}

/* ---------- 上下文条 ---------- */
.composer-context-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  max-width: 750px;
}

.friday-composer.is-conversation .composer-context-bar {
  max-width: 900px;
  margin: 0 auto;
}

.context-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--border-color);
  border-radius: 18px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.context-btn:hover {
  background: var(--bg-secondary);
}

.context-btn .chev {
  opacity: 0.6;
}

/* ---------- 输入框按钮 ---------- */
.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  border-radius: 20px;
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
}

.plus-btn {
  padding: 8px;
  color: var(--text-secondary);
}

.plus-btn:hover {
  background: var(--bg-secondary);
}

.dropdown-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.dropdown-btn span {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dropdown-btn:hover {
  background: var(--bg-secondary);
}

.trigger-model-icon {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  object-fit: contain;
}

/* ---------- 下拉通用 ---------- */
.dropdown-overlay {
  animation: dropdownIn 0.15s ease-out;
}

@keyframes dropdownIn {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: translateY(0); }
}

.dropdown-panel {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
}

.dropdown-item {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13.5px;
  color: var(--text-primary);
  cursor: pointer;
}

.dropdown-item:hover {
  background: var(--bg-hover);
}

.dropdown-item.active {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
  font-weight: 600;
}

/* ---------- 工作区下拉 ---------- */
.workspace-dropdown {
  min-width: 260px;
  max-width: 340px;
  padding: 8px;
}

.panel-title {
  padding: 4px 10px 8px;
  font-size: 11.5px;
  color: var(--text-tertiary);
  font-weight: 600;
}

.workspace-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workspace-item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-item-path {
  max-width: 110px;
  font-size: 10.5px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-check {
  flex-shrink: 0;
}

.workspace-del {
  display: inline-flex;
  padding: 3px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 5px;
}

.workspace-del:hover {
  background: var(--bg-hover);
  color: #ef4444;
}

.workspace-create {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  border-radius: 0 0 10px 10px;
}

.workspace-create:hover {
  background: var(--bg-secondary);
}

/* ---------- 模式下拉 ---------- */
.mode-dropdown {
  min-width: 150px;
  padding: 6px;
}

/* ---------- 加号菜单 ---------- */
.plus-dropdown {
  position: relative;
  min-width: 190px;
  padding: 8px;
}

.plus-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 9px;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}

.plus-menu-item:hover {
  background: var(--bg-secondary);
}

.plus-menu-item .sub-arrow {
  margin-left: auto;
  opacity: 0.5;
}

.plus-menu-sep {
  height: 1px;
  background: var(--border-color);
  margin: 6px 4px;
}

.plus-sub-panel {
  position: absolute;
  left: calc(100% + 6px);
  top: 0;
  min-width: 180px;
  max-height: 340px;
  overflow-y: auto;
  padding: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12);
}

.sub-title {
  padding: 4px 8px 8px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-tertiary);
}

.sub-empty {
  padding: 10px 8px;
  font-size: 12.5px;
  color: var(--text-tertiary);
}

.sub-item {
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-primary);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sub-item:hover {
  background: var(--bg-secondary);
}

/* ---------- 模型下拉 ---------- */
.model-dropdown {
  min-width: 340px;
  max-width: 400px;
  padding: 10px;
}

.model-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--border-color);
  border-radius: 9px;
  color: var(--text-tertiary);
}

.model-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12.5px;
}

.model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.model-think-row {
  padding: 10px 2px 9px;
  border-bottom: 1px solid var(--border-color);
}

.model-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-primary);
}

.think-tabs {
  display: flex;
  gap: 2px;
  background: var(--bg-secondary);
  border-radius: 7px;
  padding: 2px;
}

.think-tab {
  padding: 4px 10px;
  border: none;
  background: transparent;
  border-radius: 5px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
}

.think-tab.active {
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.model-model-list {
  margin-top: 8px;
  max-height: 320px;
  overflow-y: auto;
}

.model-group-label {
  padding: 8px 6px 4px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);
  text-transform: uppercase;
}

.model-item {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  gap: 9px;
}

.model-item:hover {
  background: var(--bg-secondary);
}

.model-item.active {
  background: rgba(16, 185, 129, 0.1);
}

.model-icon {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  object-fit: contain;
  flex-shrink: 0;
}

.model-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  gap: 3px;
}

.model-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.model-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-ctx {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 600;
}

.model-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.cap-badge {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9.5px;
  line-height: 1.5;
  font-weight: 600;
}

.cap-vision { background: rgba(59, 130, 246, 0.12); color: #2563eb; }
.cap-reasoning { background: rgba(139, 92, 246, 0.12); color: #7c3aed; }
.cap-tools { background: rgba(16, 185, 129, 0.12); color: #059669; }
.cap-code { background: rgba(245, 158, 11, 0.12); color: #d97706; }
.cap-embedding { background: rgba(107, 114, 128, 0.12); color: #6b7280; }

.model-item.active .model-name {
  color: #059669;
}

.model-check {
  flex-shrink: 0;
}

.model-empty {
  padding: 20px 8px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 12.5px;
}

/* ---------- 新建工作区对话框 ---------- */
.ws-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.35);
}

.ws-dialog {
  width: 380px;
  max-width: 92vw;
  padding: 22px;
  border-radius: 16px;
  background: var(--bg-primary);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
}

.ws-dialog-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.ws-dialog-label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin: 12px 0 6px;
}

.ws-dialog-input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 11px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
}

.ws-dialog-path {
  display: flex;
  gap: 6px;
}

.ws-dialog-browse {
  flex-shrink: 0;
  width: 40px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
}

.ws-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.ws-dialog-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
}

.ws-dialog-btn.primary {
  border-color: #10b981;
  background: #10b981;
  color: #fff;
}
</style>
