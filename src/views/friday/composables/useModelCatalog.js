import { computed, ref } from 'vue';
import {
  MODEL_STORAGE_KEY,
  SELECTED_MODEL_KEY,
  providerIcons,
  inferCapabilities,
  inferContextLabel
} from '@/views/friday/constants';
import { useFridayStore } from '@/store';

export function loadCustomModelsFromStorage() {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load custom models:', error);
    return [];
  }
}

export function loadModelConfig(modelId) {
  try {
    const models = loadCustomModelsFromStorage();
    const findById = (id) => (id ? models.find(model => model.id === id) : null);
    return findById(modelId)
      || findById(localStorage.getItem(SELECTED_MODEL_KEY))
      || models[0]
      || null;
  } catch (error) {
    console.error('Failed to load model config:', error);
    return null;
  }
}

export function useModelCatalog() {
  const fridayStore = useFridayStore();
  const customModels = ref([]);

  const modelList = computed(() => customModels.value.map(model => ({
    id: model.id,
    name: `${model.providerLabel} ${model.modelName}`,
    modelName: model.modelName,
    provider: model.provider,
    providerLabel: model.providerLabel,
    embeddingName: model.embeddingModelName || '',
    icon: providerIcons[model.provider] || providerIcons.other,
    capabilities: inferCapabilities(model),
    contextLabel: model.contextWindow || inferContextLabel(model.modelName),
    raw: model
  })));

  function loadCustomModels() {
    customModels.value = loadCustomModelsFromStorage();
    const selectedId = fridayStore.modelId || localStorage.getItem(SELECTED_MODEL_KEY);
    const exists = customModels.value.some(model => model.id === selectedId);
    fridayStore.setModelId(exists ? selectedId : (customModels.value[0]?.id || ''));
  }

  return {
    customModels,
    modelList,
    loadCustomModels,
    loadModelConfig
  };
}
