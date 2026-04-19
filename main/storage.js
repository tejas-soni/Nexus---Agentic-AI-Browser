'use strict';

/**
 * Electron-store wrapper for all persisted data.
 */

const Store = require('electron-store');

const schema = {
  setup: {
    type: 'object',
    properties: {
      completed: { type: 'boolean', default: false },
    },
    default: {},
  },
  llm: {
    type: 'object',
    properties: {
      provider: { type: 'string', enum: ['openrouter', 'ollama', 'pollinations'], default: 'openrouter' },
      openrouterApiKey: { type: 'string', default: '' },
      openrouterModel: { type: 'string', default: 'meta-llama/llama-3.3-70b-instruct:free' },
      ollamaBaseUrl: { type: 'string', default: 'http://localhost:11434' },
      ollamaModel: { type: 'string', default: '' },
      pollinationsApiKey: { type: 'string', default: '' },
      pollinationsModel: { type: 'string', default: 'openai' },
      searchEngine: { type: 'string', enum: ['google', 'brave', 'duckduckgo', 'bing'], default: 'google' },
      timeout: { type: 'number', default: 300 },
    },
    default: {},
  },
  cachedModels: {
    type: ['object', 'array'],
    default: {},
  },
  agents: {
    type: 'array',
    default: [],
  },
  notes: {
    type: 'array',
    default: [],
  },
  bookmarks: {
    type: 'array',
    default: [],
  },
  history: {
    type: 'array',
    default: [],
  },
  preferences: {
    type: 'object',
    properties: {
      theme: { type: 'string', enum: ['dark', 'light', 'system'], default: 'dark' },
      sidebarExpanded: { type: 'boolean', default: true },
      homePage: { type: 'string', default: 'nexus://newtab' },
    },
    default: {},
  },
};

let _store = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getStore() {
  if (!_store) {
    _store = new Store({ schema, name: 'nexus-data' });
  }
  return _store;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function getSettings() {
  const store = getStore();
  return {
    provider: store.get('llm.provider', 'openrouter'),
    openrouterApiKey: store.get('llm.openrouterApiKey', ''),
    openrouterModel: store.get('llm.openrouterModel', 'meta-llama/llama-3.3-70b-instruct:free'),
    ollamaBaseUrl: store.get('llm.ollamaBaseUrl', 'http://localhost:11434'),
    ollamaModel: store.get('llm.ollamaModel', ''),
    searchEngine: store.get('llm.searchEngine', 'google'),
    timeout: store.get('llm.timeout', 300),
  };
}

function saveSettings(newSettings) {
  const store = getStore();
  const current = getSettings();
  
  // Merge logic: Only overwrite if the new value is TRUTHY or an explicit empty string we want to save
  // This prevents accidental clearing during partial updates.
  if (newSettings.provider) store.set('llm.provider', newSettings.provider);
  
  if (typeof newSettings.openrouterApiKey === 'string') {
    // Only save if it's not the default placeholder or if we actually meant to change it
    store.set('llm.openrouterApiKey', newSettings.openrouterApiKey);
  }
  
  if (newSettings.openrouterModel) store.set('llm.openrouterModel', newSettings.openrouterModel);
  if (newSettings.ollamaBaseUrl) store.set('llm.ollamaBaseUrl', newSettings.ollamaBaseUrl);
  if (newSettings.ollamaModel) store.set('llm.ollamaModel', newSettings.ollamaModel);
  if (newSettings.searchEngine) store.set('llm.searchEngine', newSettings.searchEngine);
  
  if (newSettings.timeout !== undefined) {
    const val = parseInt(newSettings.timeout);
    if (!isNaN(val)) store.set('llm.timeout', val);
  }
}

function getCachedModels(provider) {
  const cached = getStore().get('cachedModels', {});

  // Backward compatibility with the older single-array cache format.
  if (Array.isArray(cached)) {
    return cached;
  }

  if (provider) {
    return Array.isArray(cached[provider]) ? cached[provider] : [];
  }

  return cached;
}

function cacheModels(providerOrModels, maybeModels) {
  const hasProvider = typeof providerOrModels === 'string';
  const provider = hasProvider ? providerOrModels : null;
  const models = hasProvider ? maybeModels : providerOrModels;

  if (!Array.isArray(models) || models.length === 0) {
    return;
  }

  const store = getStore();

  if (!provider) {
    store.set('cachedModels', models);
    return;
  }

  const cached = store.get('cachedModels', {});

  if (Array.isArray(cached)) {
    store.set('cachedModels', { [provider]: models });
    return;
  }

  store.set('cachedModels', { ...cached, [provider]: models });
}

// ─── Notes ────────────────────────────────────────────────────────────────────

function getNotes() {
  return getStore().get('notes', []);
}

function saveNote(note) {
  const store = getStore();
  const notes = store.get('notes', []);
  const existing = notes.findIndex((n) => n.id === note.id);
  if (existing >= 0) {
    notes[existing] = note;
  } else {
    notes.unshift({ ...note, id: note.id || Date.now().toString() });
  }
  store.set('notes', notes.slice(0, 500)); // Cap at 500 notes
  return notes;
}

function deleteNote(noteId) {
  const store = getStore();
  const notes = store.get('notes', []).filter((n) => n.id !== noteId);
  store.set('notes', notes);
  return notes;
}

// ─── Agents ───────────────────────────────────────────────────────────────────

function getAgents() {
  return getStore().get('agents', []).map((agent) => ({
    ...agent,
    name: escapeHtml(agent.name),
    description: escapeHtml(agent.description),
  }));
}

function saveAgent(agent) {
  const store = getStore();
  const agents = store.get('agents', []);
  const existing = agents.findIndex((a) => a.id === agent.id);
  if (existing >= 0) {
    agents[existing] = agent;
  } else {
    agents.unshift({ ...agent, id: agent.id || Date.now().toString() });
  }
  store.set('agents', agents);
  return agents;
}

function deleteAgent(agentId) {
  const store = getStore();
  const agents = store.get('agents', []).filter((a) => a.id !== agentId);
  store.set('agents', agents);
  return agents;
}

// ─── Bookmarks ────────────────────────────────────────────────────────────────

function getBookmarks() {
  return getStore().get('bookmarks', []);
}

function addBookmark(bookmark) {
  const store = getStore();
  const bookmarks = store.get('bookmarks', []);
  bookmarks.unshift({ ...bookmark, id: Date.now().toString(), addedAt: Date.now() });
  store.set('bookmarks', bookmarks);
  return bookmarks;
}

function removeBookmark(bookmarkId) {
  const store = getStore();
  const bookmarks = store.get('bookmarks', []).filter((b) => b.id !== bookmarkId);
  store.set('bookmarks', bookmarks);
  return bookmarks;
}

// ─── History ──────────────────────────────────────────────────────────────────

function addToHistory(entry) {
  const store = getStore();
  const history = store.get('history', []);
  history.unshift({ ...entry, visitedAt: Date.now() });
  store.set('history', history.slice(0, 1000)); // Keep last 1000 entries
}

function getHistory() {
  return getStore().get('history', []);
}

function clearHistory() {
  getStore().set('history', []);
}

// ─── Preferences ─────────────────────────────────────────────────────────────

function getPreferences() {
  const prefs = getStore().get('preferences', {});

  return {
    theme: prefs.theme ?? 'dark',
    sidebarExpanded: prefs.sidebarExpanded ?? true,
    homePage: prefs.homePage ?? 'nexus://newtab',
  };
}

function savePreferences(prefs) {
  const store = getStore();
  const current = getPreferences();
  
  // Only merge keys that belong to the preferences schema
  const allowedKeys = ['theme', 'sidebarExpanded', 'homePage'];
  const filteredPrefs = {};
  
  allowedKeys.forEach(key => {
    if (prefs[key] !== undefined) filteredPrefs[key] = prefs[key];
  });

  store.set('preferences', { ...current, ...filteredPrefs });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function markSetupComplete() {
  getStore().set('setup.completed', true);
}

function isSetupComplete() {
  return getStore().get('setup.completed', false);
}

function resetSetup() {
  const store = getStore();
  store.set('setup.completed', false);
  store.set('llm', {});
}

module.exports = {
  getStore,
  getSettings,
  saveSettings,
  getNotes,
  saveNote,
  deleteNote,
  getAgents,
  saveAgent,
  deleteAgent,
  getBookmarks,
  addBookmark,
  removeBookmark,
  addToHistory,
  getHistory,
  clearHistory,
  getPreferences,
  savePreferences,
  markSetupComplete,
  isSetupComplete,
  resetSetup,
  getCachedModels,
  cacheModels,
};
