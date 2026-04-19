'use strict';

/**
 * IPC Handlers — bridge between Electron main process and renderer.
 * All two-way communication goes through ipcMain.handle (request-response)
 * or ipcMain.on (fire-and-forget with event.sender.send for responses).
 */

const { ipcMain, shell } = require('electron');
const {
  getSettings, saveSettings,
  getNotes, saveNote, deleteNote,
  getAgents, saveAgent, deleteAgent,
  getBookmarks, addBookmark, removeBookmark,
  addToHistory, getHistory, clearHistory,
  getPreferences, savePreferences,
  markSetupComplete,
} = require('./storage');
const { fetchOpenRouterModels, fetchOllamaModels, fetchPollinationsModels, pingOllama, streamLLM } = require('./llmRouter');
const { runAgent } = require('./agentRunner');

// Map of agentId → abort functions for running agents
const runningAgents = new Map();
// Map of chatId → abort functions for running LLM streams
const activeLlmStreams = new Map();

module.exports = function registerIpcHandlers() {

  // ─── Setup ────────────────────────────────────────────────────────────────

  ipcMain.handle('setup:fetch-openrouter-models', async (_, apiKey) => {
    try {
      const models = await fetchOpenRouterModels(apiKey);
      return { success: true, models };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('setup:ping-ollama', async (_, baseUrl) => {
    try {
      const alive = await pingOllama(baseUrl);
      if (!alive) return { success: false, error: 'Ollama is not reachable' };
      const models = await fetchOllamaModels(baseUrl);
      return { success: true, models };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ─── Settings ──────────────────────────────────────────────────────────────
  // (Migrated to SettingsService)

  // ─── LLM Chat Streaming ───────────────────────────────────────────────────

  ipcMain.on('log:renderer', (event, msg) => {
    console.log(`[NEXUS:UI] ${msg}`);
  });

  ipcMain.on('llm:stream', (event, { chatId, messages, model }) => {
    const settings = getSettings();
    
    if (activeLlmStreams.has(chatId)) {
      console.log(`[NEXUS:MAIN] Aborting existing stream for: ${chatId}`);
      activeLlmStreams.get(chatId)();
    }

    const timeoutMs = parseInt(settings.timeout) * 1000 || 300000;
    const watchdog = setTimeout(() => {
      if (activeLlmStreams.has(chatId)) {
        console.error(`[NEXUS:MAIN] Stream watchdog triggered (${timeoutMs/1000}s timeout) for: ${chatId}`);
        activeLlmStreams.get(chatId)();
        activeLlmStreams.delete(chatId);
        event.sender.send('llm:error', { chatId, error: 'Connection timeout. Your CPU is taking longer than the current setting to respond. You can increase this in Settings.' });
      }
    }, timeoutMs);

    const abortReq = streamLLM({
      settings,
      messages,
      model,
      onChunk: (chunk) => {
        event.sender.send('llm:chunk', { chatId, chunk });
      },
      onDone: () => {
        console.log(`[NEXUS:MAIN] Stream complete: ${chatId}`);
        clearTimeout(watchdog);
        activeLlmStreams.delete(chatId);
        event.sender.send('llm:done', { chatId });
      },
      onError: (err) => {
        console.error(`[NEXUS:MAIN] Stream error for ${chatId}:`, err.message);
        clearTimeout(watchdog);
        activeLlmStreams.delete(chatId);
        event.sender.send('llm:error', { chatId, error: err.message });
      },
    });

    activeLlmStreams.set(chatId, abortReq);
  });

  ipcMain.handle('llm:stop', (_, chatId) => {
    if (activeLlmStreams.has(chatId)) {
      activeLlmStreams.get(chatId)();
      activeLlmStreams.delete(chatId);
    }
    return { success: true };
  });

  // ─── Agents ────────────────────────────────────────────────────────────────

  ipcMain.handle('agents:get', () => {
    const agents = getAgents();
    console.log(`[NEXUS:MAIN] agents:get -> ${agents.length} agents`);
    return agents;
  });
  ipcMain.handle('agents:save', (_, agent) => {
    const agents = saveAgent(agent);
    console.log(`[NEXUS:MAIN] agents:save -> ${agents.length} agents`);
    return agents;
  });
  ipcMain.handle('agents:delete', (_, agentId) => {
    const agents = deleteAgent(agentId);
    console.log(`[NEXUS:MAIN] agents:delete -> ${agents.length} agents`);
    return agents;
  });

  ipcMain.on('agent:run', (event, { agentId, goal, tabId, model }) => {
    if (runningAgents.has(agentId)) {
      runningAgents.get(agentId).abort();
    }

    const agents = getAgents();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) {
      event.sender.send('agent:error', { agentId, error: 'Agent not found in database.' });
      return;
    }

    const settings = getSettings();
    const targetModel = model || agent.model;

    const browserActions = {
      getSnapshot: async () => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve({ success: false, error: 'Snapshot timed out' }), 5000);
          ipcMain.once('tab:snapshot-result', (_, result) => {
            clearTimeout(timeout);
            resolve(result);
          });
          event.sender.send('tab:request-snapshot');
        });
      },
      interact: async (action, data) => {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve({ success: false, error: 'Interaction timed out' }), 5000);
          ipcMain.once('tab:interact-result', (_, result) => {
            clearTimeout(timeout);
            resolve(result);
          });
          event.sender.send('tab:request-interact', { action, data });
        });
      },
      navigate: async (url) => {
        event.sender.send('tab:open-url', url);
        return { success: true };
      },
      closeTabs: async (direction) => {
        event.sender.send('tab:close-tabs-command', direction);
        return { success: true };
      },
      bookmark: async () => {
        event.sender.send('tab:bookmark-command');
        return { success: true };
      },
      setTheme: async (mode) => {
        event.sender.send('settings:set-theme-command', mode);
        return { success: true };
      }
    };

    const runnerConfig = runAgent({
      agentId,
      agentName: agent.name,
      agentDescription: agent.description,
      task: goal,
      model: targetModel,
      settings,
      browserActions,
      onStep: (step) => {
        event.sender.send('agent:step', { agentId, step });
      },
      onDone: () => {
        runningAgents.delete(agentId);
        event.sender.send('agent:done', { agentId });
      },
      onError: (err) => {
        runningAgents.delete(agentId);
        event.sender.send('agent:error', { agentId, error: err.message });
      },
    });

    runningAgents.set(agentId, runnerConfig);
  });

  ipcMain.handle('agent:stop', (_, agentId) => {
    if (runningAgents.has(agentId)) {
      runningAgents.get(agentId).abort();
      runningAgents.delete(agentId);
    }
    return { success: true };
  });

  ipcMain.on('agent:send-instruction', (event, { agentId, text }) => {
    if (runningAgents.has(agentId)) {
      runningAgents.get(agentId).sendInstruction(text);
    }
  });

  // ─── Notes ─────────────────────────────────────────────────────────────────

  ipcMain.handle('notes:get', () => getNotes());
  ipcMain.handle('notes:save', (_, note) => saveNote(note));
  ipcMain.handle('notes:delete', (_, noteId) => deleteNote(noteId));

  // ─── Bookmarks & History ───────────────────────────────────────────────────
  // (Migrated to respective Service classes in the Platform Hub)

  // ─── Native UI Menus ────────────────────────────────────────────────────────

  ipcMain.on('tab:show-context-menu', (event, params) => {
    const { Menu, clipboard, BrowserWindow } = require('electron');
    const { x, y, linkURL, srcURL, mediaType, pageURL, selectionText } = params;

    const template = [];

    if (linkURL) {
      template.push({
        label: 'Open Link in New Tab',
        click: () => event.sender.send('tab:open-new-tab', linkURL)
      });
      template.push({
        label: 'Copy Link Address',
        click: () => clipboard.writeText(linkURL)
      });
      template.push({ type: 'separator' });
    }

    if (srcURL && mediaType === 'image') {
      template.push({
        label: 'Copy Image Address',
        click: () => clipboard.writeText(srcURL)
      });
      template.push({ type: 'separator' });
    }

    if (selectionText) {
      template.push({
        label: 'Copy',
        role: 'copy',
        click: () => clipboard.writeText(selectionText)
      });
      template.push({ type: 'separator' });
    }

    template.push(
      { label: 'Back', click: () => event.sender.send('tab:menu-action', 'back') },
      { label: 'Forward', click: () => event.sender.send('tab:menu-action', 'forward') },
      { label: 'Reload', click: () => event.sender.send('tab:menu-action', 'reload') },
      { type: 'separator' },
      { label: 'Inspect Element', click: () => event.sender.send('tab:menu-action', { action: 'inspect', x, y }) }
    );

    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) {
      Menu.buildFromTemplate(template).popup({ window });
    }
  });

  // ─── Browser Automation ──────────────────────────────────────────

  ipcMain.handle('tab:get-snapshot', async (event) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: 'Snapshot timed out' }), 5000);
      ipcMain.once('tab:snapshot-result', (_, result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      event.sender.send('tab:request-snapshot');
    });
  });

  ipcMain.handle('tab:interact', async (event, { action, data }) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ success: false, error: 'Interaction timed out' }), 5000);
      ipcMain.once('tab:interact-result', (_, result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      event.sender.send('tab:request-interact', { action, data });
    });
  });

  // ─── Shell ─────────────────────────────────────────────────────────────────

  ipcMain.handle('shell:open-external', async (_, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (e) {
      console.error(`[NEXUS:MAIN] Failed to open external URL: ${url}`, e);
      return { success: false, error: e.message };
    }
  });

};
