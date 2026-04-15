'use strict';

/**
 * Preload script — runs in the renderer context with access to Node.js APIs.
 * Exposes a secure, limited API to the renderer via contextBridge.
 * This is the ONLY way the renderer can communicate with the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexus', {
  // ─── Setup ────────────────────────────────────────────────────────────────
  setup: {
    complete: (data) => ipcRenderer.invoke('setup:complete', data),
    fetchOpenRouterModels: (apiKey) => ipcRenderer.invoke('setup:fetch-openrouter-models', apiKey),
    pingOllama: (baseUrl) => ipcRenderer.invoke('setup:ping-ollama', baseUrl),
  },

  // ─── Window Controls ──────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (cb) => ipcRenderer.on('window:maximized-change', (_, val) => cb(val)),
  },

  // ─── Settings ─────────────────────────────────────────────────────────────
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    fetchModels: () => ipcRenderer.invoke('settings:fetch-models'),
  },

  // ─── LLM Chat ─────────────────────────────────────────────────────────────
  llm: {
    stream: (chatId, messages, model) => ipcRenderer.send('llm:stream', { chatId, messages, model }),
    onChunk: (cb) => ipcRenderer.on('llm:chunk', (_, data) => cb(data)),
    onDone: (cb) => ipcRenderer.on('llm:done', (_, data) => cb(data)),
    onError: (cb) => ipcRenderer.on('llm:error', (_, data) => cb(data)),
    stop: (chatId) => ipcRenderer.invoke('llm:stop', chatId),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('llm:chunk');
      ipcRenderer.removeAllListeners('llm:done');
      ipcRenderer.removeAllListeners('llm:error');
    },
  },

  // ─── Agents ───────────────────────────────────────────────────────────────
  agents: {
    get: () => ipcRenderer.invoke('agents:get'),
    save: (agent) => ipcRenderer.invoke('agents:save', agent),
    delete: (agentId) => ipcRenderer.invoke('agents:delete', agentId),
    run: (data) => ipcRenderer.send('agent:run', data),
    stop: (agentId) => ipcRenderer.invoke('agent:stop', agentId),
    onStep: (cb) => ipcRenderer.on('agent:step', (_, data) => cb(data)),
    onDone: (cb) => ipcRenderer.on('agent:done', (_, data) => cb(data)),
    onError: (cb) => ipcRenderer.on('agent:error', (_, data) => cb(data)),
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('agent:step');
      ipcRenderer.removeAllListeners('agent:done');
      ipcRenderer.removeAllListeners('agent:error');
    },
  },

  // ─── Notes ────────────────────────────────────────────────────────────────
  notes: {
    get: () => ipcRenderer.invoke('notes:get'),
    save: (note) => ipcRenderer.invoke('notes:save', note),
    delete: (noteId) => ipcRenderer.invoke('notes:delete', noteId),
  },

  // ─── Bookmarks ────────────────────────────────────────────────────────────
  bookmarks: {
    get: () => ipcRenderer.invoke('bookmarks:get'),
    add: (bookmark) => ipcRenderer.invoke('bookmarks:add', bookmark),
    remove: (id) => ipcRenderer.invoke('bookmarks:remove', id),
  },

  // ─── History ──────────────────────────────────────────────────────────────
  history: {
    get: () => ipcRenderer.invoke('history:get'),
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    clear: () => ipcRenderer.invoke('history:clear'),
  },

  // ─── Tab Events & Automation ─────────────────────────────────────
  tabs: {
    onOpenUrl: (cb) => ipcRenderer.on('tab:open-url', (_, url) => cb(url)),
    executeScript: (tabId, script) => ipcRenderer.invoke('tab:execute-script', { tabId, script }),
    getSnapshot: (tabId) => ipcRenderer.invoke('tab:get-snapshot', { tabId }),
    interact: (tabId, action, data) => ipcRenderer.invoke('tab:interact', { tabId, action, data }),
    
    // Listeners for Main → Renderer automation requests
    onSnapshotRequest: (cb) => ipcRenderer.on('tab:request-snapshot', (e) => cb(e)),
    onInteractRequest: (cb) => ipcRenderer.on('tab:request-interact', (e, data) => cb(e, data)),
    
    // Senders for Renderer → Main automation responses
    sendSnapshotResult: (result) => ipcRenderer.send('tab:snapshot-result', result),
    sendInteractResult: (result) => ipcRenderer.send('tab:interact-result', result),
  },

  // ─── Shell ────────────────────────────────────────────────────────────────
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },

  // ─── Diagnostics ──────────────────────────────────────────────────────────
  log: (msg) => ipcRenderer.send('log:renderer', msg),
});
