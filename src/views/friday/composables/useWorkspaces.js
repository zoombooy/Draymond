import { computed, ref } from 'vue';
import { SELECTED_WORKSPACE_KEY, WORKSPACE_STORAGE_KEY } from '../constants';

const DEFAULT_WORKSPACE = {
  id: 'default',
  name: '默认工作区',
  path: '',
  builtin: true
};

function readWorkspaces() {
  try {
    const raw = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
      .map(item => ({
        id: item.id,
        name: item.name,
        path: typeof item.path === 'string' ? item.path : '',
        builtin: item.id === DEFAULT_WORKSPACE.id
      }));
  } catch (error) {
    console.error('Failed to load workspaces:', error);
    return [];
  }
}

function writeWorkspaces(list) {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(list));
  } catch (error) {
    console.error('Failed to save workspaces:', error);
  }
}

export function useWorkspaces() {
  const workspaces = ref([DEFAULT_WORKSPACE, ...readWorkspaces().filter(item => item.id !== DEFAULT_WORKSPACE.id)]);

  const selectedId = ref(localStorage.getItem(SELECTED_WORKSPACE_KEY) || DEFAULT_WORKSPACE.id);
  const selectedWorkspace = computed(() => (
    workspaces.value.find(item => item.id === selectedId.value) || workspaces.value[0] || DEFAULT_WORKSPACE
  ));

  function persist() {
    writeWorkspaces(workspaces.value.filter(item => !item.builtin));
  }

  function selectWorkspace(id) {
    if (!workspaces.value.some(item => item.id === id)) return false;
    selectedId.value = id;
    try {
      localStorage.setItem(SELECTED_WORKSPACE_KEY, id);
    } catch {}
    return true;
  }

  function addWorkspace({ name, path = '' }) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    if (workspaces.value.some(item => item.name === trimmed)) return null;
    const workspace = {
      id: `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: trimmed,
      path: String(path || '').trim(),
      builtin: false
    };
    workspaces.value.push(workspace);
    persist();
    return workspace;
  }

  function renameWorkspace(id, name) {
    const target = workspaces.value.find(item => item.id === id);
    const trimmed = String(name || '').trim();
    if (!target || target.builtin || !trimmed) return false;
    if (workspaces.value.some(item => item.id !== id && item.name === trimmed)) return false;
    target.name = trimmed;
    persist();
    return true;
  }

  function removeWorkspace(id) {
    const target = workspaces.value.find(item => item.id === id);
    if (!target || target.builtin) return false;
    workspaces.value = workspaces.value.filter(item => item.id !== id);
    if (selectedId.value === id) selectWorkspace(DEFAULT_WORKSPACE.id);
    persist();
    return true;
  }

  function reload() {
    workspaces.value = [DEFAULT_WORKSPACE, ...readWorkspaces().filter(item => item.id !== DEFAULT_WORKSPACE.id)];
    if (!workspaces.value.some(item => item.id === selectedId.value)) {
      selectWorkspace(DEFAULT_WORKSPACE.id);
    }
  }

  return {
    workspaces,
    selectedId,
    selectedWorkspace,
    selectWorkspace,
    addWorkspace,
    renameWorkspace,
    removeWorkspace,
    reload
  };
}
