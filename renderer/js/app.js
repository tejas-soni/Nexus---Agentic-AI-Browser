'use strict';

/**
 * Nexus Browser — Main Renderer Entry Point
 * Coordinates tabs, sidebar, and right panels.
 */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('[NEXUS] DOM Content Loaded. Initializing Engine...');

    let settings;
    try {
        settings = await window.nexus.settings.get();
        console.log('[NEXUS] Settings loaded successfully.');
    } catch (err) {
        console.error('[NEXUS] Critical Error: Bridge not responding.', err);
        return; // Stop if bridge is broken
    }
    
    // Application State
    const state = {
        tabs: [],
        activeTabId: null,
        activePanel: 'home',
        isSidebarExpanded: settings.sidebarExpanded !== false,
        settings: settings,
        closedTabs: []
    };

    // Diagnostic: Check Bookmarks state on load
    try {
        const bms = await window.nexus.bookmarks.get();
        console.log(`[DEBUG:DB] Bookmarks detected in SQLite: ${bms.length}`);
    } catch (e) {
        console.warn('[DEBUG:DB] Could not verify bookmarks state:', e.message);
    }

    let availableModels = [];

    async function loadAvailableModels(retryCount = 0) {
        const chatModelSelect = document.getElementById('chat-model-select');
        
        if (chatModelSelect && (chatModelSelect.innerHTML.includes('Loading models...') || chatModelSelect.innerHTML.includes('Fetching brains...'))) {
            chatModelSelect.innerHTML = '<option value="">Connecting to AI Provider...</option>';
        }
        
        try {
            const res = await window.nexus.settings.fetchModels();
            if (res.success && res.models && res.models.length > 0) {
                availableModels = res.models;
                if (chatModelSelect) {
                    const savedSettings = await window.nexus.settings.get();
                    const provider = savedSettings.provider || 'openrouter';
                    const targetModel = provider === 'openrouter' ? savedSettings.openrouterModel : (provider === 'ollama' ? savedSettings.ollamaModel : (provider === 'groq' ? savedSettings.groqModel : savedSettings.pollinationsModel));
                    
                    chatModelSelect.innerHTML = availableModels.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
                    
                    if (targetModel && availableModels.some(m => m.id === targetModel)) {
                        chatModelSelect.value = targetModel;
                    }
                }
            } else {
                console.warn('[NEXUS:UI] Model fetch failed:', res.error);
                if (retryCount < 3) {
                    const delay = 2000 * (retryCount + 1);
                    console.log(`[NEXUS:UI] Retrying connection in ${delay}ms... (Attempt ${retryCount + 1})`);
                    setTimeout(() => loadAvailableModels(retryCount + 1), delay);
                } else if (chatModelSelect && chatModelSelect.value === "") {
                    chatModelSelect.innerHTML = `<option value="">Offline: Check Settings</option>`;
                }
            }
        } catch (err) {
            console.error('[NEXUS:UI] Critical error during model fetch:', err);
        }
    }
    window.loadNexusModels = loadAvailableModels;
    
    // Save model selection when user changes it
    const chatModelSelect = document.getElementById('chat-model-select');
    if (chatModelSelect) {
        chatModelSelect.addEventListener('change', async (e) => {
            const settings = await window.nexus.settings.get();
            const provider = settings.provider || 'openrouter';
            if (provider === 'openrouter') settings.openrouterModel = e.target.value;
            else if (provider === 'ollama') settings.ollamaModel = e.target.value;
            else if (provider === 'pollinations') settings.pollinationsModel = e.target.value;
            else if (provider === 'groq') settings.groqModel = e.target.value;
            await window.nexus.settings.save(settings);
            console.log(`[NEXUS:UI] Model selection saved natively.`);
        });
    }
    
    // Refresh models when settings change
    window.nexus.settings.onUpdated(() => {
        console.log('[NEXUS:UI] Settings updated. Refreshing models...');
        loadAvailableModels();
        if (window.loadAgents) window.loadAgents(); 
    });


    // ─── OVERKILL STABILITY FIX: Global Agent/Note Handlers ──────
    document.addEventListener('click', async (e) => {
        const target = e.target;
        const btn = target.closest('button');
        if (!btn) return;

        if (btn.id === 'btn-create-agent') {
            handleCreateAgent();
        } else if (btn.classList.contains('btn-run')) {
            handleRunAgent(btn.getAttribute('data-id'));
        } else if (btn.classList.contains('btn-stop')) {
            handleStopAgent(btn.getAttribute('data-id'));
        } else if (btn.classList.contains('btn-instruct')) {
            handleInstructAgent(btn.getAttribute('data-id'));
        } else if (btn.classList.contains('btn-edit')) {
            handleEditAgent(btn.getAttribute('data-id'));
        } else if (btn.classList.contains('btn-delete')) {
            handleDeleteAgent(btn.getAttribute('data-id'));
        } else if (btn.id === 'btn-stop-global') {
            // Re-enabling legacy global stop
            window.nexus.agents.stopAll();
            showToast('Stopping all running agents...', 'warning');
        }

        if (btn.id === 'btn-new-note') {
            if (typeof window.editNote === 'function') window.editNote(null);
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.id?.startsWith('instruct-input-')) {
            e.preventDefault();
            handleInstructAgent(e.target.id.replace('instruct-input-', ''));
        }
    });

    // DOM Elements Mapping
    const elements = {
        sidebar: document.getElementById('sidebar'),
        sidebarToggle: document.getElementById('sidebar-toggle'),
        tabList: document.getElementById('tab-list'),
        btnNewTab: document.getElementById('btn-new-tab'),
        addressBar: document.getElementById('addressbar'),
        urlInput: document.getElementById('url-input'),
        btnBack: document.getElementById('btn-back'),
        btnForward: document.getElementById('btn-forward'),
        btnReload: document.getElementById('btn-reload'),
        btnShields: document.getElementById('btn-shields'),
        shieldsPopup: document.getElementById('shields-popup'),
        shieldsDomain: document.getElementById('shields-domain'),
        shieldCount: document.getElementById('shield-count'),
        toggleShieldsOn: document.getElementById('toggle-shields-on'),
        toggleHttpsUpgrade: document.getElementById('toggle-https-upgrade'),
        toggleFingerprinting: document.getElementById('toggle-fingerprinting'),
        webviewContainer: document.getElementById('webview-container'),
        rightPanel: document.getElementById('right-panel'),
        btnAiToggle: document.getElementById('btn-ai-toggle'),
        navItems: document.querySelectorAll('.sidebar__item'),
        panelSections: document.querySelectorAll('.panel-section'),
        closeBtns: document.querySelectorAll('.panel-header__close'),
        toastContainer: document.getElementById('toast-container'),
        btnBookmark: document.getElementById('btn-bookmark'),
        // Window Controls
        btnMinimize: document.getElementById('btn-minimize'),
        btnMaximize: document.getElementById('btn-maximize'),
        btnClose: document.getElementById('btn-close')
    };

    // ─── Window Control Logic ─────────────────────────────────────
    if (elements.btnMinimize) elements.btnMinimize.onclick = () => window.nexus.window.minimize();
    if (elements.btnMaximize) elements.btnMaximize.onclick = () => window.nexus.window.maximize();
    if (elements.btnClose) elements.btnClose.onclick = () => window.nexus.window.close();

    window.nexus.window.onMaximizedChange((isMaximized) => {
        if (elements.btnMaximize) {
            elements.btnMaximize.title = isMaximized ? 'Restore' : 'Maximize';
        }
    });

    // ─── Browser UI Sync ──────────────────────────────────────────
    function updateNavUI() {
        const activeTab = state.tabs.find(t => t.id === state.activeTabId);
        if (!activeTab || !activeTab.webview) return;
        
        try {
            if (elements.btnBack) elements.btnBack.disabled = !activeTab.webview.canGoBack();
            if (elements.btnForward) elements.btnForward.disabled = !activeTab.webview.canGoForward();
        } catch (e) {
            // Webview might not be ready
        }
    }

    if (elements.btnBack) elements.btnBack.onclick = () => {
        const wv = document.getElementById(`webview-${state.activeTabId}`);
        if (wv && wv.canGoBack()) wv.goBack();
    };
    if (elements.btnForward) elements.btnForward.onclick = () => {
        const wv = document.getElementById(`webview-${state.activeTabId}`);
        if (wv && wv.canGoForward()) wv.goForward();
    };
    if (elements.btnReload) elements.btnReload.onclick = () => {
        const wv = document.getElementById(`webview-${state.activeTabId}`);
        if (wv) wv.reload();
    };

    // ─── Nexus Shields Logic ──────────────────────────────────────
    let blockedStats = { total: 0 };

    function getActiveDomain() {
        const activeTab = state.tabs.find(t => t.id === state.activeTabId);
        if (!activeTab || !activeTab.url) return 'newtab';
        try {
            const url = new URL(activeTab.url);
            return url.hostname;
        } catch {
            return activeTab.url;
        }
    }

    async function updateShieldsUI() {
        const domain = getActiveDomain();
        if (elements.shieldsDomain) elements.shieldsDomain.innerText = domain;
        const config = await window.nexus.shields.getConfig(domain);
        if (elements.toggleShieldsOn) elements.toggleShieldsOn.checked = config.enabled !== false;
        if (elements.toggleHttpsUpgrade) elements.toggleHttpsUpgrade.checked = config.httpsUpgrade !== false;
        if (elements.toggleFingerprinting) elements.toggleFingerprinting.checked = config.fingerprinting !== false;
        const stats = await window.nexus.shields.getStats();
        if (elements.shieldCount) elements.shieldCount.innerText = stats.blockedCount || 0;
    }

    async function toggleShieldsDropdown() {
        if (!elements.shieldsPopup) return;
        const isHidden = elements.shieldsPopup.classList.contains('hidden');
        if (isHidden) {
            await updateShieldsUI();
            elements.shieldsPopup.classList.remove('hidden');
        } else {
            elements.shieldsPopup.classList.add('hidden');
        }
    }

    if (elements.btnShields) elements.btnShields.onclick = (e) => { e.stopPropagation(); toggleShieldsDropdown(); };

    const saveShieldConfig = async () => {
        const domain = getActiveDomain();
        const config = {
            enabled: elements.toggleShieldsOn?.checked,
            httpsUpgrade: elements.toggleHttpsUpgrade?.checked,
            fingerprinting: elements.toggleFingerprinting?.checked
        };
        await window.nexus.shields.saveConfig(domain, config);
        const activeTab = state.tabs.find(t => t.id === state.activeTabId);
        if (activeTab && activeTab.webview) activeTab.webview.reload();
    };

    if (elements.toggleShieldsOn) elements.toggleShieldsOn.onchange = saveShieldConfig;
    if (elements.toggleHttpsUpgrade) elements.toggleHttpsUpgrade.onchange = saveShieldConfig;
    if (elements.toggleFingerprinting) elements.toggleFingerprinting.onchange = saveShieldConfig;

    window.nexus.shields.onStatsUpdate((data) => {
        if (elements.shieldCount) elements.shieldCount.innerText = data.total;
        if (elements.btnShields) {
            elements.btnShields.style.color = 'var(--accent)';
            setTimeout(() => { if (elements.btnShields) elements.btnShields.style.color = ''; }, 500);
        }
    });

    document.addEventListener('click', (e) => {
        if (elements.shieldsPopup && !elements.shieldsPopup.contains(e.target) && e.target !== elements.btnShields) {
            elements.shieldsPopup.classList.add('hidden');
        }
    });

    // ─── Utilities ────────────────────────────────────────────────
    
    function showToast(message, type = 'info') {
        if (!elements.toastContainer) return;
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
            warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
        };
        toast.innerHTML = `${icons[type]} <span>${message}</span>`;
        elements.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'toast-out 0.3s var(--ease-spring) forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    window.showToast = showToast;

    function showModal(title, fields = []) {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal__header">
                    <div class="modal__title">${title}</div>
                    <button class="modal-close" id="modal-cancel-btn">&times;</button>
                </div>
                <div class="modal__body">
                    ${fields.map(f => `
                        <div class="input-field">
                            <label class="input-label">${f.label}</label>
                            ${f.type === 'textarea' ? 
                                `<textarea class="input" id="modal-f-${f.id}" placeholder="${f.placeholder || ''}" rows="3">${f.value || ''}</textarea>` :
                              f.type === 'select' ?
                                `<select class="input" id="modal-f-${f.id}">
                                    ${(f.options || []).map(opt => `<option value="${opt.id}" ${opt.id === f.value ? 'selected' : ''}>${opt.name}</option>`).join('')}
                                 </select>` :
                              f.type === 'emoji' ?
                                `<input type="hidden" id="modal-f-${f.id}" value="${f.value || '🤖'}">
                                 <div class="emoji-grid">
                                    ${['🤖','🦁','🦊','🐶','🐱','🐻','🐼','🛒','💸','🔍','📊','✈️','🏠','🎸','🎨','💻'].map(e => `
                                        <button class="emoji-btn ${e === (f.value || '🤖') ? 'active' : ''}" onclick="this.parentElement.previousElementSibling.value='${e}'; this.parentElement.querySelectorAll('.emoji-btn').forEach(b=>b.classList.remove('active')); this.classList.add('active'); event.preventDefault();">${e}</button>
                                    `).join('')}
                                 </div>` :
                                `<input class="input" type="${f.type || 'text'}" id="modal-f-${f.id}" value="${f.value || ''}" placeholder="${f.placeholder || ''}">`
                            }
                        </div>
                    `).join('')}
                </div>
                <div class="modal__footer">
                    <button class="btn btn-ghost" id="modal-cancel-footer-btn">Cancel</button>
                    <button class="btn btn-primary" id="modal-save-btn">Save</button>
                </div>
            `;
            overlay.appendChild(modal);
            document.body.appendChild(overlay);

            const resolveData = (cancelled) => {
                if (cancelled) resolve(null);
                else {
                    const data = {};
                    fields.forEach(f => {
                        const el = modal.querySelector(`#modal-f-${f.id}`);
                        if (el) data[f.id] = el.value;
                    });
                    resolve(data);
                }
                overlay.remove();
            };

            modal.querySelector('#modal-save-btn').addEventListener('click', () => resolveData(false));
            modal.querySelector('#modal-cancel-btn').addEventListener('click', () => resolveData(true));
            modal.querySelector('#modal-cancel-footer-btn').addEventListener('click', () => resolveData(true));
            overlay.addEventListener('click', (e) => { if (e.target === overlay) resolveData(true); });
        });
    }

    // ─── Sidebar Logic ────────────────────────────────────────────
    function setSidebarExpanded(expanded) {
        state.isSidebarExpanded = expanded;
        if (elements.sidebar) elements.sidebar.classList.toggle('expanded', expanded);
        window.nexus.settings.save({ ...state.settings, sidebarExpanded: expanded });
    }
    if (elements.sidebarToggle) elements.sidebarToggle.onclick = () => setSidebarExpanded(!state.isSidebarExpanded);

    // ─── Keyboard Shortcuts ─────────────────────────────────────────
    window.addEventListener('keydown', (e) => {
        // Ctrl + B: Toggle Sidebar
        if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); setSidebarExpanded(!state.isSidebarExpanded); }
        
        // Ctrl + T: New Tab
        if (e.ctrlKey && !e.shiftKey && (e.key === 't' || e.key === 'T')) { e.preventDefault(); createTab(); }
        
        // Ctrl + Shift + T: Reopen Closed Tab
        if (e.ctrlKey && e.shiftKey && (e.key === 't' || e.key === 'T')) { 
            e.preventDefault(); 
            if (state.closedTabs.length > 0) {
                const lastUrl = state.closedTabs.pop();
                createTab(lastUrl);
                showToast('Tab reopened', 'success');
            }
        }
        
        // Ctrl + W: Close Tab
        if (e.ctrlKey && (e.key === 'w' || e.key === 'W')) { e.preventDefault(); closeTab(state.activeTabId); }
        
        // Ctrl + R: Reload
        if (e.ctrlKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); const wv = document.getElementById(`webview-${state.activeTabId}`); if (wv) wv.reload(); }
        
        // Ctrl + H: History
        if (e.ctrlKey && (e.key === 'h' || e.key === 'H')) { e.preventDefault(); navigateTo('nexus://history'); }
        
        // Ctrl + L: Focus Address Bar
        if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); if (elements.urlInput) elements.urlInput.focus(); elements.urlInput.select(); }
    });

    elements.navItems.forEach(item => {
        item.onclick = () => {
            const panel = item.getAttribute('data-panel');
            if (panel === 'home' || !panel) { closeAllPanels(); navigateTo('nexus://newtab'); } 
            else if (['settings', 'bookmarks', 'history'].includes(panel)) { closeAllPanels(); navigateTo(`nexus://${panel}`); }
            else openPanel(panel);
            elements.navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        };
    });

    function openPanel(panelId) {
        elements.panelSections.forEach(sec => sec.classList.remove('active'));
        const target = document.getElementById(`panel-${panelId}`);
        if (target) { target.classList.add('active'); elements.rightPanel.classList.add('open'); state.activePanel = panelId; }
    }
    function closeAllPanels() { if (elements.rightPanel) elements.rightPanel.classList.remove('open'); state.activePanel = 'home'; }
    elements.closeBtns.forEach(btn => btn.onclick = closeAllPanels);
    if (elements.btnAiToggle) elements.btnAiToggle.onclick = () => { if (elements.rightPanel.classList.contains('open') && state.activePanel === 'chat') closeAllPanels(); else openPanel('chat'); };

    // ─── Direct Snapshot Helper (Prevents Deadlocks) ───────────────
    async function getDistilledSnapshot() {
        const wv = document.getElementById(`webview-${state.activeTabId}`);
        if (!wv) return { success: true, snapshot: { title: 'New Tab', url: 'nexus://newtab', summary: 'On home screen.' } };
        
        try {
            const script = await fetch('js/domDistiller.js').then(r => r.text());
            const result = await wv.executeJavaScript(script);
            return { success: true, snapshot: result };
        } catch (err) {
            console.error('[NEXUS:CTX] Local distillation failed', err);
            return { success: false, error: err.message };
        }
    }

    // ─── Tab Logic ────────────────────────────────────────────────
    function createTab(url = null) {
        const id = Date.now().toString();
        const targetUrl = url || 'nexus://newtab';
        const tab = { id, url: targetUrl, title: 'New Tab', loading: false, favicon: null, webview: null };
        state.tabs.push(tab);
        renderTabs();
        const webview = document.createElement('webview');
        webview.id = `webview-${id}`; webview.src = targetUrl;
        tab.webview = webview;
        webview.setAttribute('allowpopups', ''); 
        webview.setAttribute('allowfullscreen', '');
        elements.webviewContainer.appendChild(webview);
        setupWebviewEvents(webview, id);
        switchTab(id);
    }

    function setupWebviewEvents(webview, tabId) {
        // Find reference
        const getTab = () => state.tabs.find(t => t.id === tabId);

        webview.addEventListener('did-start-loading', () => { 
            const tab = getTab(); 
            if (tab) { 
                tab.loading = true; 
                renderTabs(); 
                if (state.activeTabId === tabId) updateNavUI();
            } 
        });

        webview.addEventListener('did-stop-loading', () => {
            const tab = getTab();
            if (tab) {
                tab.loading = false; 
                tab.title = webview.getTitle(); 
                tab.url = webview.getURL();
                renderTabs();
                if (state.activeTabId === tabId) {
                    elements.urlInput.value = (tab.url.startsWith('nexus://')) ? '' : tab.url;
                    updateBookmarkStatus(tab.url);
                    updateNavUI();
                }
                window.nexus.history.add({ title: tab.title, url: tab.url, favicon: tab.favicon });
            }
        });

        webview.addEventListener('did-start-navigation', (e) => {
            if (e.isMainFrame) {
                const tab = getTab();
                if (tab) {
                    tab.url = e.url;
                    if (state.activeTabId === tabId) {
                        elements.urlInput.value = tab.url.startsWith('nexus://') ? '' : tab.url;
                        updateNavUI();
                    }
                }
            }
        });

        webview.addEventListener('load-commit', (e) => {
            if (e.isMainFrame) {
                const tab = getTab();
                if (tab) {
                    tab.url = e.url;
                    if (state.activeTabId === tabId) {
                        elements.urlInput.value = tab.url.startsWith('nexus://') ? '' : tab.url;
                    }
                }
            }
        });

        webview.addEventListener('page-title-updated', (e) => {
            const tab = getTab();
            if (tab) { tab.title = e.title; renderTabs(); }
        });

        webview.addEventListener('page-favicon-updated', (e) => { 
            const tab = getTab(); 
            if (tab) { tab.favicon = e.favicons[0]; renderTabs(); } 
        });

        webview.addEventListener('new-window', (e) => { e.preventDefault(); createTab(e.url); });

        webview.addEventListener('did-navigate', () => {
            if (state.activeTabId === tabId) updateNavUI();
        });

        webview.addEventListener('did-navigate-in-page', () => {
            if (state.activeTabId === tabId) updateNavUI();
        });

        /**
         * Internal IPC Tunnel Handler (Relocated)
         * Intercepts nexus:// page requests via console.log
         */
        webview.addEventListener('console-message', async (e) => {
            const msg = e.message;
            if (!msg || !msg.startsWith('NEXUS_IPC:')) return;

            try {
                const { action, data, reqId } = JSON.parse(msg.replace('NEXUS_IPC:', ''));
                console.log(`[NEXUS:IPC] Webview[${tabId}] -> ${action}`, data);

                let result;
                const parts = action.split('.');
                const service = parts[0];
                const method = parts[1];

                if (window.nexus[service] && window.nexus[service][method]) {
                    result = await window.nexus[service][method](data);
                } else {
                    throw new Error(`Service method not found: ${action}`);
                }

                const responseScript = `
                    if (window._ipcCallbacks && window._ipcCallbacks["${reqId}"]) {
                        window._ipcCallbacks["${reqId}"](${JSON.stringify(result)});
                        delete window._ipcCallbacks["${reqId}"];
                    }
                `;
                webview.executeJavaScript(responseScript);
            } catch (err) {
                console.error('[NEXUS:IPC] Tunnel failure:', err);
            }
        });
    }

    function switchTab(id) {
        state.activeTabId = id;
        renderTabs();
        document.querySelectorAll('webview').forEach(wv => wv.style.display = 'none');
        const webview = document.getElementById(`webview-${id}`);
        if (webview) {
            webview.style.display = 'flex';
            const tab = state.tabs.find(t => t.id === id);
            elements.urlInput.value = (tab.url.startsWith('nexus://')) ? '' : tab.url;
            updateBookmarkStatus(webview.getURL());
            updateNavUI();
        }
    }

    function closeTab(id, e) {
        if (e) e.stopPropagation();
        const index = state.tabs.findIndex(t => t.id === id);
        if (index === -1) return;
        
        // Store for Ctrl+Shift+T
        const closedTab = state.tabs[index];
        if (closedTab && closedTab.url && !closedTab.url.startsWith('nexus://')) {
            state.closedTabs.push(closedTab.url);
            if (state.closedTabs.length > 50) state.closedTabs.shift();
        }

        state.tabs.splice(index, 1);
        document.getElementById(`webview-${id}`)?.remove();
        if (state.tabs.length === 0) createTab();
        else if (state.activeTabId === id) switchTab(state.tabs[Math.max(0, index - 1)].id);
        else renderTabs();
    }

    function renderTabs() {
        if (!elements.tabList) return;
        elements.tabList.innerHTML = '';
        state.tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            tabEl.className = `tab ${state.activeTabId === tab.id ? 'active' : ''}`;
            tabEl.onclick = () => switchTab(tab.id);
            
            const loadingHtml = tab.loading ? '<div class="tab__spinner"></div>' : '';
            const faviconHtml = tab.favicon ? `<img src="${tab.favicon}" class="tab__favicon">` : '<div class="tab__icon-default"></div>';
            
            tabEl.innerHTML = `
                ${loadingHtml || faviconHtml}
                <div class="tab__title">${tab.title || 'New Tab'}</div>
                <button class="tab__close">&times;</button>
            `;
            tabEl.querySelector('.tab__close').onclick = (e) => closeTab(tab.id, e);
            elements.tabList.appendChild(tabEl);
        });
    }

    function navigateTo(url) {
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        const webview = document.getElementById(`webview-${tab.id}`);
        if (webview) webview.src = url;
    }

    async function updateBookmarkStatus(url) {
        if (!elements.btnBookmark) return;
        const bookmarks = await window.nexus.bookmarks.get();
        const isBookmarked = bookmarks.some(b => b.url === url);
        elements.btnBookmark.classList.toggle('active', isBookmarked);
    }
    if (elements.btnBookmark) elements.btnBookmark.onclick = async () => {
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        const webview = document.getElementById(`webview-${tab.id}`);
        if (webview) {
            const url = webview.getURL();
            const bookmarks = await window.nexus.bookmarks.get();
            const existing = bookmarks.find(b => b.url === url);
            if (existing) await window.nexus.bookmarks.remove(existing.id);
            else await window.nexus.bookmarks.add({ title: webview.getTitle(), url, favicon: tab.favicon });
            updateBookmarkStatus(url);
        }
    };

    if (elements.urlInput) elements.urlInput.onkeydown = async (e) => {
        if (e.key === 'Enter') {
            let val = elements.urlInput.value.trim();
            if (!val) return;
            if (!val.includes('://') && !val.startsWith('nexus://')) {
                const settings = await window.nexus.settings.get();
                const engine = settings.searchEngine || 'google';
                const engines = {
                    google: 'https://www.google.com/search?q=',
                    brave: 'https://search.brave.com/search?q=',
                    duckduckgo: 'https://duckduckgo.com/?q=',
                    bing: 'https://www.bing.com/search?q='
                };
                const baseUrl = engines[engine] || engines.google;
                val = baseUrl + encodeURIComponent(val);
            }
            navigateTo(val);
        }
    };

    if (elements.btnNewTab) elements.btnNewTab.onclick = () => createTab();

    // ─── Bridge Events ──────────────────────────────────────────
    window.nexus.tabs.onOpenUrl?.((url) => {
        navigateTo(url);
        showToast(`Agent is navigating...`, 'info');
    });

    window.nexus.tabs.onOpenNewTab?.((url) => {
        createTab(url);
        showToast('Agent opened a new tab.', 'info');
    });

    window.nexus.tabs.onMenuAction?.((data) => {
        const webview = document.getElementById(`webview-${state.activeTabId}`);
        if (!webview) return;
        if (data === 'back') { if(webview.canGoBack()) webview.goBack(); }
        else if (data === 'forward') { if(webview.canGoForward()) webview.goForward(); }
        else if (data === 'reload') webview.reload();
        else if (data.action === 'inspect') webview.inspectElement(data.x, data.y);
    });

    window.nexus.tabs.onCloseTabsCommand?.((_, direction) => {
        const activeId = state.activeTabId;
        const index = state.tabs.findIndex(t => t.id === activeId);
        if (index === -1) return;

        let toClose = [];
        if (direction === 'left') toClose = state.tabs.slice(0, index);
        else if (direction === 'right') toClose = state.tabs.slice(index + 1);
        else if (direction === 'other') toClose = state.tabs.filter(t => t.id !== activeId);

        toClose.forEach(t => closeTab(t.id));
        showToast(`Agent closed ${toClose.length} tabs.`, 'info');
    });

    window.nexus.tabs.onBookmarkCommand?.(() => {
        const btn = document.getElementById('btn-bookmark');
        if (btn) btn.click();
    });

    window.nexus.tabs.onSnapshotRequest?.(async () => {
        const res = await getDistilledSnapshot();
        window.nexus.tabs.sendSnapshotResult(res);
    });

    window.nexus.tabs.onInteractRequest?.((_, { action, data }) => {
        const webview = document.getElementById(`webview-${state.activeTabId}`);
        if (!webview) return;
        let script = action === 'click' ? `window.nexusInteract.click("${data.id}")` : `window.nexusInteract.type("${data.id}", "${data.text}")`;
        webview.executeJavaScript(script).then(r => window.nexus.tabs.sendInteractResult({ success: r }));
    });

    // ─── AI CHAT (IRONCLAD) ───────────────────────────────────────
    function initImageGen() {
        const promptInput = document.getElementById('imagegen-prompt');
        const sendBtn = document.getElementById('imagegen-send');
        const gallery = document.getElementById('imagegen-gallery');
        
        if (!promptInput || !sendBtn || !gallery) return;

        sendBtn.onclick = () => {
            const val = promptInput.value.trim();
            if (!val) return;
            
            promptInput.value = '';
            
            // Remove empty state if present
            const emptyState = gallery.querySelector('.empty-state');
            if (emptyState) emptyState.remove();

            // Create generation placeholder
            const card = document.createElement('div');
            card.style.position = 'relative';
            card.style.borderRadius = '12px';
            card.style.overflow = 'hidden';
            card.style.marginBottom = '16px';
            card.style.backgroundColor = 'var(--bg-elevated)';
            card.style.minHeight = '200px';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'center';
            card.style.justifyContent = 'center';
            card.style.border = '1px solid var(--border)';
            
            const loader = document.createElement('div');
            loader.innerText = 'Generating image... ✨';
            loader.style.color = 'var(--text-muted)';
            loader.style.fontSize = '12px';
            loader.style.fontWeight = '500';
            card.appendChild(loader);
            
            // Prepend new card to gallery
            gallery.prepend(card);

            // Fetch natively via img tag connected to pollinations AI
            const seed = Math.floor(Math.random() * 1000000);
            const imgUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(val)}?nologo=true&seed=${seed}`;
            
            const img = new Image();
            img.style.width = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            img.style.opacity = '0';
            img.style.transition = 'opacity 0.3s ease';

            img.onload = () => {
                loader.remove();
                card.style.minHeight = 'auto'; 
                card.appendChild(img);
                img.style.opacity = '1';
                
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'btn btn-primary';
                downloadBtn.style.position = 'absolute';
                downloadBtn.style.bottom = '12px';
                downloadBtn.style.right = '12px';
                downloadBtn.style.padding = '8px 16px';
                downloadBtn.style.fontSize = '12px';
                downloadBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
                downloadBtn.style.zIndex = '10';
                downloadBtn.innerText = 'Download';
                
                downloadBtn.onclick = async (e) => {
                    e.stopPropagation();
                    const originalText = downloadBtn.innerText;
                    downloadBtn.innerText = 'Saving...';
                    try {
                        const res = await fetch(imgUrl);
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `nexus_art_${seed}.png`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                        showToast('Image downloaded!', 'success');
                    } catch(e) {
                        console.error('Download failed', e);
                        showToast('Download failed', 'error');
                    }
                    downloadBtn.innerText = originalText;
                };

                card.appendChild(downloadBtn);
            };

            img.onerror = () => {
                loader.innerText = 'Failed to generate image. Please try again.';
                loader.style.color = 'var(--danger)';
            };

            img.src = imgUrl; 
        };
        
        promptInput.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendBtn.click();
            }
        };
    }

    function initChat() {
        const input = document.getElementById('chat-input');
        const send = document.getElementById('chat-send');
        const stopBtn = document.getElementById('chat-stop');
        const messagesEl = document.getElementById('chat-messages');
        const clearBtn = document.getElementById('chat-context-btn');
        
        let sessionMessages = [];
        let activeChatId = null;
        let currentBubble = null;
        let currentStreamText = '';

        function addMessage(role, content) {
            if (!messagesEl) return;
            const msg = document.createElement('div');
            msg.className = `chat__message chat__message--${role}`;
            msg.innerHTML = `<div class="chat__bubble">${content}</div>`;
            messagesEl.appendChild(msg);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            return msg;
        }

        window.nexus.llm.onChunk(({ chatId, chunk }) => {
            if (chatId !== activeChatId) return;
            currentStreamText += chunk;
            if (currentBubble) currentBubble.innerText = currentStreamText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
        });

        window.nexus.llm.onDone(({ chatId }) => {
            if (chatId !== activeChatId) return;
            sessionMessages.push({ role: 'assistant', content: currentStreamText });
            if (stopBtn) stopBtn.classList.add('hidden');
            if (send) send.classList.remove('hidden');
        });

        window.nexus.llm.onError(({ chatId, error }) => {
            if (chatId !== activeChatId) return;
            if (currentBubble) currentBubble.innerText = `Error: ${error}`;
            if (stopBtn) stopBtn.classList.add('hidden');
            if (send) send.classList.remove('hidden');
        });

        async function processChat() {
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            currentStreamText = '';
            activeChatId = 'chat-' + Date.now();
            
            addMessage('user', text);
            const aiMsg = addMessage('ai', 'Thinking...');
            currentBubble = aiMsg.querySelector('.chat__bubble');
            
            if (stopBtn) stopBtn.classList.remove('hidden');
            if (send) send.classList.add('hidden');

            // Ironclad Fix: Use local snapshot, no deadlock
            const snap = await getDistilledSnapshot();
            if (snap.success && snap.snapshot) {
                sessionMessages.push({ 
                    role: 'system', 
                    content: `[User is viewing: ${snap.snapshot.title} at ${snap.snapshot.url}. Summary: ${snap.snapshot.summary}]` 
                });
                showToast('AI read page context...', 'info');
            }
            
            sessionMessages.push({ role: 'user', content: text });
            const model = document.getElementById('chat-model-select')?.value;
            window.nexus.llm.stream(activeChatId, sessionMessages, model);
        }

        if (send) send.onclick = processChat;
        if (input) input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); processChat(); } };
        if (stopBtn) stopBtn.onclick = () => window.nexus.llm.stop(activeChatId);
        
        if (clearBtn) {
            clearBtn.title = 'Clear Chat History';
            clearBtn.onclick = () => {
                sessionMessages = [];
                if (messagesEl) messagesEl.innerHTML = '<div class="chat__message chat__message--ai"><div class="chat__bubble">Chat history cleared. How can I help?</div></div>';
                showToast('Chat history cleared.', 'success');
            };
        }
    }

    async function handleCreateAgent() {
        const res = await showModal('New Agent', [
            {id:'name',label:'Name'},
            {id:'description',label:'Role (Description)',type:'textarea'},
            {id:'model',label:'Model (Brain)',type:'select',options:availableModels},
            {id:'emoji',label:'Choose Personality',type:'emoji',value:'🤖'}
        ]);
        if (res) { await window.nexus.agents.save(res); window.loadAgents(); showToast('Agent created!', 'success'); }
    }

    async function handleEditAgent(id) {
        const agents = await window.nexus.agents.get();
        const a = agents.find(i => i.id === id);
        if (!a) return;
        const res = await showModal('Edit Agent', [
            {id:'name',label:'Name',value:a.name},
            {id:'description',label:'Role (Description)',type:'textarea',value:a.description},
            {id:'model',label:'Model (Brain)',type:'select',value:a.model,options:availableModels},
            {id:'emoji',label:'Choose Personality',type:'emoji',value:a.emoji}
        ]);
        if (res) { await window.nexus.agents.save({...a, ...res}); window.loadAgents(); showToast('Agent updated!', 'success'); }
    }

    async function handleDeleteAgent(id) {
        if (confirm('Delete this agent?')) { await window.nexus.agents.delete(id); window.loadAgents(); }
    }

    async function handleRunAgent(id, task = null) {
        const agents = await window.nexus.agents.get();
        const agent = agents.find(a => a.id === id);
        if (!agent) return;

        if (!task) {
            const res = await showModal(`Run ${agent.name}`, [
                {id:'task', label:'What should I do?', type:'textarea', placeholder:'e.g. Go to amazon.in and search for Laptops'}
            ]);
            if (!res || !res.task) return;
            task = res.task;
        }

        const model = agent.model || (availableModels[0] ? availableModels[0].id : null);
        console.log(`Running Agent: ${agent.name} with model: ${model}`);
        
        const card = document.getElementById(`agent-${id}`);
        const stopBtn = document.getElementById(`stop-${id}`);
        const runBtn = card?.querySelector('.btn-run');
        const interaction = document.getElementById(`interaction-${id}`);
        const log = document.getElementById(`log-${id}`);

        if (card) card.classList.add('running');
        if (log) { log.innerHTML = ''; log.classList.remove('hidden'); }
        if (stopBtn) stopBtn.classList.remove('hidden');
        if (runBtn) runBtn.classList.add('hidden');
        if (interaction) {
            interaction.classList.remove('hidden');
            const instructInput = document.getElementById(`instruct-input-${id}`);
            if (instructInput) instructInput.focus();
        }

        showToast(`Agent ${agent.name} started running...`, 'success');
        window.nexus.agents.run({ agentId: id, goal: task, tabId: null, model: model });
    }

    async function handleStopAgent(id) {
        await window.nexus.agents.stop(id);
        const card = document.getElementById(`agent-${id}`);
        const stopBtn = document.getElementById(`stop-${id}`);
        const runBtn = card?.querySelector('.btn-run');
        const interaction = document.getElementById(`interaction-${id}`);
        if (card) card.classList.remove('running');
        if (stopBtn) stopBtn.classList.add('hidden');
        if (runBtn) runBtn.classList.remove('hidden');
        if (interaction) interaction.classList.add('hidden');
        showToast('Agent stopped.', 'info');
    }

    function handleInstructAgent(id) {
        const input = document.getElementById(`instruct-input-${id}`);
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        
        window.nexus.agents.sendInstruction(id, text);
        input.value = '';
    }

    function initAgents() {
        const list = document.getElementById('agent-list');
        const createBtn = document.getElementById('btn-create-agent');
        // Redundant onclick removed here as it is handled by the global stability listener

        async function load() {
            const agents = await window.nexus.agents.get();
            if (agents.length === 0) list.innerHTML = '<div class="empty-state">No Agents found.</div>';
            else list.innerHTML = agents.map(a => `
                <div class="agent-card" id="agent-${a.id}">
                    <div class="agent-card__header">
                        <div class="agent-card__avatar">${a.emoji || '🤖'}</div>
                        <div class="agent-card__info">
                            <div class="agent-card__name">${a.name}</div>
                            <div class="agent-card__desc">${a.description || 'Specialized AI Agent'}</div>
                        </div>
                    </div>
                    <div class="agent-card__actions">
                        <button class="btn btn-primary btn-sm btn-run" data-id="${a.id}">Run</button>
                        <button class="btn btn-ghost btn-sm btn-stop hidden" id="stop-${a.id}" data-id="${a.id}">Stop</button>
                        <button class="btn btn-ghost btn-sm btn-edit" data-id="${a.id}">Edit</button>
                        <button class="btn btn-danger btn-sm btn-delete" data-id="${a.id}">Delete</button>
                    </div>
                    <div class="agent-log hidden" id="log-${a.id}"></div>
                    <div class="agent-interaction hidden" id="interaction-${a.id}" style="margin-top: 8px; display: flex; gap: 8px;">
                        <input type="text" class="input" id="instruct-input-${a.id}" placeholder="Type instruction to instantly interrupt..." style="flex: 1; padding: 6px; font-size: 12px; background: rgba(0,0,0,0.2);" autocomplete="off">
                        <button class="btn btn-primary btn-sm btn-instruct" data-id="${a.id}">Send</button>
                    </div>
                </div>
            `).join('');
        }
        window.loadAgents = load;
        
        // --- Centralized Agent Event Routing ---
        window.nexus.agents.onStep(({ agentId, step }) => {
            const container = document.getElementById(`log-${agentId}`);
            if (!container) return;
            
            container.classList.remove('hidden');
            const el = document.createElement('div');
            el.className = `agent-log__step agent-log__step--${step.type || 'info'}`;
            el.innerText = step.content;
            container.appendChild(el);
            container.scrollTop = container.scrollHeight;
        });

        window.nexus.agents.onDone(({ agentId }) => {
            showToast(`Agent task completed.`, 'success');
            const card = document.getElementById(`agent-${agentId}`);
            const stopBtn = document.getElementById(`stop-${agentId}`);
            const runBtn = card?.querySelector('.btn-run');
            const interaction = document.getElementById(`interaction-${agentId}`);
            if (card) card.classList.remove('running');
            if (stopBtn) stopBtn.classList.add('hidden');
            if (runBtn) runBtn.classList.remove('hidden');
            if (interaction) interaction.classList.add('hidden');
        });

        window.nexus.agents.onError(({ agentId, error }) => {
            showToast(`Agent Error: ${error}`, 'error');
            const card = document.getElementById(`agent-${agentId}`);
            const stopBtn = document.getElementById(`stop-${agentId}`);
            const runBtn = card?.querySelector('.btn-run');
            const interaction = document.getElementById(`interaction-${agentId}`);
            if (card) card.classList.remove('running');
            if (stopBtn) stopBtn.classList.add('hidden');
            if (runBtn) runBtn.classList.remove('hidden');
            if (interaction) interaction.classList.add('hidden');
        });
        
        load();
    }

    function initNotes() {
        const list = document.getElementById('note-list');
        window.loadNotes = async () => {
            const notes = await window.nexus.notes.get();
            list.innerHTML = notes.map(n => `
                <div class="note-card" onclick="window.editNote('${n.id}')">
                    <div class="note-card__title">${n.title || 'Untitled Note'}</div>
                    <div class="note-card__preview">${(n.content || '').substring(0, 100)}...</div>
                    <div class="note-card__meta">
                        <span>${new Date(n.updatedAt).toLocaleDateString()}</span>
                    </div>
                </div>
            `).join('');
        };
    }

    initChat();
    initImageGen();
    initAgents();
    initNotes();
    createTab();
    loadAvailableModels();
});
