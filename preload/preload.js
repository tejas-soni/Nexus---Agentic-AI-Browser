'use strict';

/**
 * Preload script — runs in the renderer context with access to Node.js APIs.
 * Exposes a secure, limited API to the renderer via contextBridge.
 * This is the ONLY way the renderer can communicate with the main process.
 */

const { contextBridge, ipcRenderer } = require('electron');

const path = require('path');
const { pathToFileURL } = require('url');

// Let Node native module handle Windows path specifications (e.g. file:///C:/...)
const PRELOAD_PATH = pathToFileURL(path.join(__dirname, 'preload.js')).toString();

contextBridge.exposeInMainWorld('nexus', {
  // Used by app.js to attach this preload to dynamically-created webview elements
  __preloadPath: PRELOAD_PATH,

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
    testConnection: () => ipcRenderer.invoke('settings:test-connection'),
    onUpdated: (cb) => ipcRenderer.on('settings:updated', (_, data) => cb(data)),
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
    sendInstruction: (agentId, text) => ipcRenderer.send('agent:send-instruction', { agentId, text }),
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
    import: () => ipcRenderer.invoke('bookmarks:import'),
    export: () => ipcRenderer.invoke('bookmarks:export'),
  },

  // ─── History ──────────────────────────────────────────────────────────────
  history: {
    get: (options) => ipcRenderer.invoke('history:get', options),
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    clear: () => ipcRenderer.invoke('history:clear'),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
  },

  // ─── Downloads ────────────────────────────────────────────────────────────
  downloads: {
    get: () => ipcRenderer.invoke('downloads:get'),
    open: (id) => ipcRenderer.invoke('downloads:open', id),
    clear: () => ipcRenderer.invoke('downloads:clear'),
    onUpdate: (cb) => {
      const listener = (_, data) => cb(data);
      ipcRenderer.on('downloads:update', listener);
      return () => ipcRenderer.removeListener('downloads:update', listener);
    },
  },

  // ─── Shields ──────────────────────────────────────────────────────────────
  shields: {
    getConfig: (domain) => ipcRenderer.invoke('shields:get-config', domain),
    saveConfig: (domain, config) => ipcRenderer.invoke('shields:save-config', { domain, config }),
    getStats: () => ipcRenderer.invoke('shields:get-stats'),
    onStatsUpdate: (cb) => ipcRenderer.on('shields:stats-update', (_, data) => cb(data)),
  },

  // ─── Tab Events & Automation ─────────────────────────────────────
  tabs: {
    sendContextMenu: (params) => ipcRenderer.send('tab:show-context-menu', params),
    onOpenUrl: (cb) => ipcRenderer.on('tab:open-url', (_, url) => cb(url)),
    onOpenNewTab: (cb) => ipcRenderer.on('tab:open-new-tab', (_, url) => cb(url)),
    onMenuAction: (cb) => ipcRenderer.on('tab:menu-action', (_, data) => cb(data)),
    executeScript: (tabId, script) => ipcRenderer.invoke('tab:execute-script', { tabId, script }),
    getSnapshot: (tabId) => ipcRenderer.invoke('tab:get-snapshot', { tabId }),
    interact: (tabId, action, data) => ipcRenderer.invoke('tab:interact', { tabId, action, data }),
    
    // Listeners for Main → Renderer automation requests
    onSnapshotRequest: (cb) => ipcRenderer.on('tab:request-snapshot', cb),
    onInteractRequest: (cb) => ipcRenderer.on('tab:request-interact', (event, data) => cb(event, data)),
    onCloseTabsCommand: (cb) => ipcRenderer.on('tab:close-tabs-command', (event, dir) => cb(event, dir)),
    onBookmarkCommand: (cb) => ipcRenderer.on('tab:bookmark-command', cb),
    
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
