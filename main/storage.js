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
      timeout: { type: 'number', default: 300 },
    },
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
    timeout: store.get('llm.timeout', 300),
  };
}

function saveSettings(settings) {
  const store = getStore();
  if (settings.provider) store.set('llm.provider', settings.provider);
  if (settings.openrouterApiKey !== undefined) store.set('llm.openrouterApiKey', settings.openrouterApiKey);
  if (settings.openrouterModel) store.set('llm.openrouterModel', settings.openrouterModel);
  if (settings.ollamaBaseUrl) store.set('llm.ollamaBaseUrl', settings.ollamaBaseUrl);
  if (settings.ollamaModel) store.set('llm.ollamaModel', settings.ollamaModel);
  if (settings.timeout !== undefined) store.set('llm.timeout', settings.timeout);
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
  return getStore().get('agents', []);
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
  return getStore().get('preferences', {});
}

function savePreferences(prefs) {
  const store = getStore();
  const current = store.get('preferences', {});
  store.set('preferences', { ...current, ...prefs });
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
};
