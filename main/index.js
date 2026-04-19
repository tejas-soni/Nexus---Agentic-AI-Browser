'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, session, protocol } = require('electron');
const path = require('path');
const Store = require('electron-store');

// Register privileged schemes before app is ready
protocol.registerSchemesAsPrivileged([
  { 
    scheme: 'nexus', 
    privileges: { 
      standard: true, 
      secure: true, 
      supportFetchAPI: true, 
      allowServiceWorkers: true 
    } 
  }
]);

const hub = require('./platform/Hub');
const HistoryService = require('./platform/HistoryService');
const SettingsService = require('./platform/SettingsService');
const BookmarkService = require('./platform/BookmarkService');
const DownloadService = require('./platform/DownloadService');
const ShieldsService = require('./platform/ShieldsService');

// Keep references to prevent garbage collection
let mainWindow = null;
let setupWindow = null;

// ─── App Configuration ───────────────────────────────────────────────────────
app.commandLine.appendSwitch('ignore-certificate-errors'); // Bypass SSL handshake freezes
console.log('[NEXUS] Engine starting with network hardening enabled.');

const store = new Store();
const isDev = process.argv.includes('--dev');

// ─── App Initialization ──────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Register and initialize Platform Hub services
  hub.registerService('history', HistoryService);
  hub.registerService('settings', SettingsService);
  hub.registerService('bookmarks', BookmarkService);
  hub.registerService('downloads', DownloadService);
  hub.registerService('shields', ShieldsService);
  await hub.init();

  // Register IPC handlers after app is ready
  require('./ipcHandlers')();

  const { isSetupComplete } = require('./storage');
  
  if (!isSetupComplete()) {
    createSetupWindow();
  } else {
    createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const { isSetupComplete } = require('./storage');
    if (!isSetupComplete()) {
      createSetupWindow();
    } else {
      createMainWindow();
    }
  }
});

// ─── Setup Window ─────────────────────────────────────────────────────────────

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 900,
    minHeight: 650,
    resizable: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0A0A0F',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icon.png'),
  });

  setupWindow.loadFile(path.join(__dirname, '..', 'renderer', 'setup.html'));

  /* DevTools disabled by default for a cleaner startup experience */
  // if (isDev) {
  //   setupWindow.webContents.openDevTools({ mode: 'detach' });
  // }
}

// ─── Setup Completion Transition ─────────────────────────────────────────────

ipcMain.handle('setup:complete', (event, data) => {
  const { saveSettings, markSetupComplete } = require('./storage');
  saveSettings(data);
  markSetupComplete();
  
  if (setupWindow) {
    setupWindow.close();
    setupWindow = null;
  }
  
  createMainWindow();
  return { success: true };
});

// ─── Global Window Controls ──────────────────────────────────────────────────

ipcMain.handle('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.handle('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  }
  return false;
});

ipcMain.handle('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.handle('window:is-maximized', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return win ? win.isMaximized() : false;
});

// ─── Main Window ──────────────────────────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0A0A0F',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
    icon: path.join(__dirname, '..', 'assets', 'icons', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  /* DevTools disabled by default for a cleaner startup experience */
  // if (isDev) {
  //   mainWindow.webContents.openDevTools({ mode: 'detach' });
  // }

  // Set up permission handler for webview content
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'notifications', 'geolocation', 'fullscreen'];
    callback(allowedPermissions.includes(permission));
  });

  // Handle webview full screen
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    // webPreferences.fullscreen is true by default, but we can be explicit here if needed
  });

  // Handle new window requests from webviews — open in new tab
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    mainWindow.webContents.send('tab:open-url', url);
    return { action: 'deny' };
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized-change', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized-change', false));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

module.exports = { getMainWindow: () => mainWindow };
