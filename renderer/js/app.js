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
        settings: settings
    };

    // Diagnostic: Check Bookmarks state on load
    try {
        const bms = await window.nexus.bookmarks.get();
        console.log(`[DEBUG:DB] Bookmarks detected in SQLite: ${bms.length}`);
    } catch (e) {
        console.warn('[DEBUG:DB] Could not verify bookmarks state:', e.message);
    }

    let availableModels = [];
    let processChat;

    async function loadAvailableModels(retryCount = 0) {
        const chatModelSelect = document.getElementById('chat-model-select');
        
        // Initial feedback for the user
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
                    const targetModel = provider === 'openrouter' ? savedSettings.openrouterModel : (provider === 'ollama' ? savedSettings.ollamaModel : savedSettings.pollinationsModel);
                    
                    chatModelSelect.innerHTML = availableModels.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
                    
                    // Restore previously selected model
                    if (targetModel && availableModels.some(m => m.id === targetModel)) {
                        chatModelSelect.value = targetModel;
                    }
                }
            } else {
                console.warn('[NEXUS:UI] Model fetch failed:', res.error);
                if (retryCount < 3) {
                    // Gradual backoff to allow network stability
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
            await window.nexus.settings.save(settings);
            console.log(`[NEXUS:UI] Model selection saved natively.`);
        });
    }
    
    // Refresh models when settings change
    window.nexus.settings.onUpdated(() => {
        console.log('[NEXUS:UI] Settings updated. Refreshing models...');
        loadAvailableModels();
        if (window.loadAgents) window.loadAgents(); // Refresh personality icons/data
    });


    // ─── OVERKILL STABILITY FIX: Global Agent/Note Handlers ──────
    // This catches clicks for ALL dynamic elements even after re-renders.
    document.addEventListener('click', async (e) => {
        const target = e.target;
        const btn = target.closest('button');
        if (!btn) return;

        // --- Agents ---
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
        }

        // --- Notes ---
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
        newTabPage: document.getElementById('newtab-page'),
        newTabSearch: document.getElementById('newtab-search'),
        rightPanel: document.getElementById('right-panel'),
        btnAiToggle: document.getElementById('btn-ai-toggle'),
        navItems: document.querySelectorAll('.sidebar__item'),
        panelSections: document.querySelectorAll('.panel-section'),
        closeBtns: document.querySelectorAll('.panel-header__close'),
        toastContainer: document.getElementById('toast-container'),
        btnBookmark: document.getElementById('btn-bookmark')
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
        elements.shieldsDomain.innerText = domain;
        
        // Load persistency
        const config = await window.nexus.shields.getConfig(domain);
        elements.toggleShieldsOn.checked = config.enabled !== false;
        elements.toggleHttpsUpgrade.checked = config.httpsUpgrade !== false;
        elements.toggleFingerprinting.checked = config.fingerprinting !== false;

        // Load stats
        const stats = await window.nexus.shields.getStats();
        elements.shieldCount.innerText = stats.blockedCount || 0;
    }

    async function toggleShieldsDropdown() {
        const isHidden = elements.shieldsPopup.classList.contains('hidden');
        if (isHidden) {
            await updateShieldsUI();
            elements.shieldsPopup.classList.remove('hidden');
        } else {
            elements.shieldsPopup.classList.add('hidden');
        }
    }

    if (elements.btnShields) {
        elements.btnShields.onclick = (e) => {
            e.stopPropagation();
            toggleShieldsDropdown();
        };
    }

    // Auto-save changes
    const saveShieldConfig = async () => {
        const domain = getActiveDomain();
        const config = {
            enabled: elements.toggleShieldsOn?.checked,
            httpsUpgrade: elements.toggleHttpsUpgrade?.checked,
            fingerprinting: elements.toggleFingerprinting?.checked
        };
        await window.nexus.shields.saveConfig(domain, config);
        
        // Reload current tab to apply blocking/unblocking immediately
        const activeTab = state.tabs.find(t => t.id === state.activeTabId);
        if (activeTab && activeTab.webview) {
            activeTab.webview.reload();
        }
    };

    if (elements.toggleShieldsOn) elements.toggleShieldsOn.onchange = saveShieldConfig;
    if (elements.toggleHttpsUpgrade) elements.toggleHttpsUpgrade.onchange = saveShieldConfig;
    if (elements.toggleFingerprinting) elements.toggleFingerprinting.onchange = saveShieldConfig;

    // Listen for real-time blocking events
    window.nexus.shields.onStatsUpdate((data) => {
        if (elements.shieldCount) elements.shieldCount.innerText = data.total;
        // Subtle glow effect on shield icon when blocking occurs
        if (elements.btnShields) {
            elements.btnShields.style.color = 'var(--accent)';
            setTimeout(() => { if (elements.btnShields) elements.btnShields.style.color = ''; }, 500);
        }
    });

    // Close popup on click outside
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
            const container = document.getElementById('modal-container') || document.body;
            container.appendChild(overlay);

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
                overlay.style.animation = 'fade-out 0.2s ease forwards';
                modal.style.animation = 'modal-out 0.2s ease forwards';
                setTimeout(() => overlay.remove(), 200);
            };

            modal.querySelector('#modal-save-btn').addEventListener('click', (e) => { e.stopPropagation(); resolveData(false); });
            modal.querySelector('#modal-cancel-btn').addEventListener('click', (e) => { e.stopPropagation(); resolveData(true); });
            modal.querySelector('#modal-cancel-footer-btn').addEventListener('click', (e) => { e.stopPropagation(); resolveData(true); });
            overlay.addEventListener('click', (e) => { if (e.target === overlay) { e.stopPropagation(); resolveData(true); } });
            
            setTimeout(() => { 
                const first = modal.querySelector('input, textarea'); 
                if (first) first.focus(); 
            }, 100);
            
            modal.onkeydown = (e) => {
                if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); resolveData(false); }
                else if (e.key === 'Escape') resolveData(true);
            };
        });
    }

    // ─── Sidebar Logic ────────────────────────────────────────────
    
    function setSidebarExpanded(expanded) {
        state.isSidebarExpanded = expanded;
        if (elements.sidebar) elements.sidebar.classList.toggle('expanded', expanded);
        window.nexus.settings.save({ sidebarExpanded: expanded });
    }

    if (elements.sidebarToggle) {
        elements.sidebarToggle.onclick = () => setSidebarExpanded(!state.isSidebarExpanded);
    }

    // Sidebar Toggle Shortcut
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
            e.preventDefault();
            if (elements.sidebarToggle) elements.sidebarToggle.click();
        }
    });

    elements.navItems.forEach(item => {
        item.onclick = () => {
            const panel = item.getAttribute('data-panel');
            if (panel === 'home' || !panel) {
                closeAllPanels();
                showNewTabPage();
            } else if (['settings', 'bookmarks', 'history', 'downloads'].includes(panel)) {
                closeAllPanels();
                navigateTo(`nexus://${panel}`);
            } else {
                openPanel(panel);
            }
            elements.navItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        };
    });

    // ─── Panel Logic ──────────────────────────────────────────────
    
    function openPanel(panelId) {
        elements.panelSections.forEach(sec => sec.classList.remove('active'));
        const target = document.getElementById(`panel-${panelId}`);
        if (target) {
            target.classList.add('active');
            elements.rightPanel.classList.add('open');
            state.activePanel = panelId;
        }
    }

    function closeAllPanels() {
        if (elements.rightPanel) elements.rightPanel.classList.remove('open');
        state.activePanel = 'home';
    }

    elements.closeBtns.forEach(btn => { btn.onclick = closeAllPanels; });

    if (elements.btnAiToggle) {
        elements.btnAiToggle.onclick = () => {
            if (elements.rightPanel.classList.contains('open') && state.activePanel === 'chat') {
                closeAllPanels();
            } else {
                openPanel('chat');
            }
        };
    }

    // ─── Tab Logic ────────────────────────────────────────────────
    
    function createTab(url = null) {
        const id = Date.now().toString();
        const targetUrl = url || 'nexus://newtab';
        const tab = { id, url: targetUrl, title: 'New Tab', loading: false, favicon: null };
        state.tabs.push(tab);
        renderTabs();
        
        const webview = document.createElement('webview');
        webview.id = `webview-${id}`;
        webview.setAttribute('allowpopups', '');
        webview.setAttribute('allowfullscreen', '');
        
        webview.src = targetUrl;
        
        elements.webviewContainer.appendChild(webview);
        setupWebviewEvents(webview, id);
        
        switchTab(id);
        return id;
    }

    function setupWebviewEvents(webview, tabId) {
        webview.addEventListener('did-start-loading', async () => {
            const tab = state.tabs.find(t => t.id === tabId);
            if (tab) { tab.loading = true; renderTabs(); }
            
            // Inject Anti-Fingerprinting script if enabled for this domain
            try {
                const url = new URL(webview.getURL());
                const config = await window.nexus.shields.getConfig(url.hostname);
                if (config.fingerprinting !== false) {
                    const script = await fetch('../preload/shields.js').then(r => r.text());
                    webview.executeJavaScript(script);
                }
            } catch (e) {}
        });
        webview.addEventListener('did-stop-loading', () => {
            const tab = state.tabs.find(t => t.id === tabId);
            if (tab) {
                tab.loading = false;
                tab.title = webview.getTitle();
                tab.url = webview.getURL();
                renderTabs();
                if (state.activeTabId === tabId) {
                    if (elements.urlInput) {
                        elements.urlInput.value = (tab.url === 'nexus://newtab' || tab.url === 'nexus://newtab/') ? '' : tab.url;
                    }
                    updateNavButtons(webview);
                }
                
                // History hardening: ensure we use the definitive values from the webview
                const finalTitle = webview.getTitle();
                const finalUrl = webview.getURL();
                window.nexus.history.add({ title: finalTitle, url: finalUrl, favicon: tab.favicon });

                // Update bookmark status on navigation
                if (state.activeTabId === tabId) {
                    updateBookmarkStatus(finalUrl);
                }
            }
        });
        webview.addEventListener('page-title-updated', (e) => {
            const tab = state.tabs.find(t => t.id === tabId);
            if (tab) { tab.title = e.title; renderTabs(); }
        });
        webview.addEventListener('page-favicon-updated', (e) => {
            const tab = state.tabs.find(t => t.id === tabId);
            if (tab) { tab.favicon = e.favicons[0]; renderTabs(); }
        });

        webview.addEventListener('enter-html-full-screen', () => {
            document.body.classList.add('is-fullscreen');
        });
        webview.addEventListener('leave-html-full-screen', () => {
            document.body.classList.remove('is-fullscreen');
        });

        webview.addEventListener('new-window', (e) => {
            e.preventDefault();
            createTab(e.url);
        });
        webview.addEventListener('context-menu', (e) => {
            e.preventDefault();
            window.nexus.tabs.sendContextMenu({
                x: e.params.x,
                y: e.params.y,
                linkURL: e.params.linkURL,
                srcURL: e.params.srcURL,
                mediaType: e.params.mediaType,
                pageURL: e.params.pageURL,
                selectionText: e.params.selectionText
            });
        });
        webview.addEventListener('console-message', async (e) => {
            if (e.message.startsWith('NEXUS_IPC:')) {
                try {
                    const req = JSON.parse(e.message.replace('NEXUS_IPC:', ''));
                    let res;
                    if (req.action === 'settings.get') res = await window.nexus.settings.get();
                    else if (req.action === 'settings.save') res = await window.nexus.settings.save(req.data);
                    else if (req.action === 'settings.testConnection') res = await window.nexus.settings.testConnection();
                    
                    else if (req.action === 'history.get') res = await window.nexus.history.get(req.data);
                    else if (req.action === 'history.add') res = await window.nexus.history.add(req.data);
                    else if (req.action === 'history.remove') res = await window.nexus.history.remove(req.data);
                    else if (req.action === 'history.clear') res = await window.nexus.history.clear();
                    
                    else if (req.action === 'bookmarks.get') res = await window.nexus.bookmarks.get(req.data);
                    else if (req.action === 'bookmarks.add') res = await window.nexus.bookmarks.add(req.data);
                    else if (req.action === 'bookmarks.remove') res = await window.nexus.bookmarks.remove(req.data);
                    else if (req.action === 'bookmarks.clear') res = await window.nexus.bookmarks.clear();
                    else if (req.action === 'bookmarks.import') res = await window.nexus.bookmarks.import();
                    else if (req.action === 'bookmarks.export') res = await window.nexus.bookmarks.export();
                    
                    const safeRes = btoa(unescape(encodeURIComponent(JSON.stringify(res || {}))));
                    webview.executeJavaScript(`if(window._ipcCallbacks && window._ipcCallbacks["${req.reqId}"]) { window._ipcCallbacks["${req.reqId}"](JSON.parse(decodeURIComponent(escape(atob("${safeRes}"))))); delete window._ipcCallbacks["${req.reqId}"]; }`).catch(console.error);
                } catch (err) {
                    console.error('[NEXUS:IPC-Tunnel] Error:', err);
                }
            }
        });
    }

    function switchTab(id) {
        state.activeTabId = id;
        const tab = state.tabs.find(t => t.id === id);
        renderTabs();
        document.querySelectorAll('webview').forEach(wv => wv.style.display = 'none');
        elements.newTabPage.style.display = 'none';
        
        const webview = document.getElementById(`webview-${id}`);
        if (webview) {
            webview.style.display = 'flex';
            if (elements.urlInput) {
                elements.urlInput.value = (tab.url === 'nexus://newtab' || tab.url === 'nexus://newtab/') ? '' : tab.url;
            }
            updateNavButtons(webview);
            updateBookmarkStatus(webview.getURL());
        }
    }

    function closeTab(id, e) {
        if (e) e.stopPropagation();
        const index = state.tabs.findIndex(t => t.id === id);
        if (index === -1) return;
        state.tabs.splice(index, 1);
        const webview = document.getElementById(`webview-${id}`);
        if (webview) webview.remove();
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
            const favicon = tab.favicon ? `<img src="${tab.favicon}">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
            tabEl.innerHTML = `
                <div class="tab__favicon">${tab.loading ? '<div class="spinner spinner--sm"></div>' : favicon}</div>
                <div class="tab__title">${tab.title || 'New Tab'}</div>
                <button class="tab__close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            `;
            tabEl.querySelector('.tab__close').onclick = (e) => closeTab(tab.id, e);
            elements.tabList.appendChild(tabEl);
        });
    }

    function showNewTabPage() {
        navigateTo('nexus://newtab');
    }

    // ─── Navigation Logic ─────────────────────────────────────────

    function updateNavButtons(webview) {
        if (elements.btnBack) elements.btnBack.disabled = !webview.canGoBack();
        if (elements.btnForward) elements.btnForward.disabled = !webview.canGoForward();
    }

    function navigateTo(url) {
        let tab = state.tabs.find(t => t.id === state.activeTabId);
        tab.url = url;
        let webview = document.getElementById(`webview-${tab.id}`);
        if (!webview) {
            webview = document.createElement('webview');
            webview.id = `webview-${tab.id}`;
            webview.setAttribute('allowpopups', '');
            webview.setAttribute('allowfullscreen', '');
            elements.webviewContainer.appendChild(webview);
            setupWebviewEvents(webview, tab.id);
        }
        webview.src = url;
        switchTab(tab.id);
    }

    async function updateBookmarkStatus(url) {
        if (!elements.btnBookmark || !url) return;
        if (url.startsWith('nexus://') || url.startsWith('about:')) {
            elements.btnBookmark.classList.remove('active');
            return;
        }

        const bookmarks = await window.nexus.bookmarks.get();
        const isBookmarked = bookmarks.some(b => b.url === url);
        
        if (isBookmarked) {
            elements.btnBookmark.classList.add('active');
            elements.btnBookmark.title = 'Remove bookmark';
        } else {
            elements.btnBookmark.classList.remove('active');
            elements.btnBookmark.title = 'Bookmark this page';
        }
    }

    if (elements.btnBookmark) {
        elements.btnBookmark.onclick = async () => {
            const tab = state.tabs.find(t => t.id === state.activeTabId);
            const webview = document.getElementById(`webview-${tab.id}`);
            if (tab && webview) {
                const title = webview.getTitle() || tab.title || 'Untitled';
                const url = webview.getURL() || tab.url;
                
                if (url.startsWith('nexus://') || url.startsWith('about:')) {
                    showToast('Cannot bookmark internal pages', 'warning');
                    return;
                }

                const bookmarks = await window.nexus.bookmarks.get();
                const existing = bookmarks.find(b => b.url === url);

                if (existing) {
                    await window.nexus.bookmarks.remove(existing.id);
                    showToast('Bookmark removed', 'info');
                } else {
                    await window.nexus.bookmarks.add({ title, url, favicon: tab.favicon });
                    showToast('Page bookmarked!', 'success');
                }
                updateBookmarkStatus(url);
            }
        };
    }

    elements.btnBack.onclick = () => { const wv = document.getElementById(`webview-${state.activeTabId}`); if (wv) wv.goBack(); };
    elements.btnForward.onclick = () => { const wv = document.getElementById(`webview-${state.activeTabId}`); if (wv) wv.goForward(); };
    elements.btnReload.onclick = () => { const tab = state.tabs.find(t => t.id === state.activeTabId); if (tab.url !== 'nexus://newtab') { const wv = document.getElementById(`webview-${state.activeTabId}`); if (wv) wv.reload(); } };

    if (elements.urlInput) {
        elements.urlInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                let val = elements.urlInput.value.trim();
                if (!val) return;
                if (!val.includes('://') && !val.startsWith('nexus://') && !val.startsWith('about:')) {
                    if (val.includes('.') && !val.includes(' ')) val = 'https://' + val;
                    else val = 'https://www.google.com/search?q=' + encodeURIComponent(val);
                }
                if (val.startsWith('about:')) val = 'nexus://' + val.substr(6);
                navigateTo(val);
            }
        };
    }

    if (elements.btnNewTab) elements.btnNewTab.onclick = () => createTab();
    window.nexus.tabs.onOpenUrl?.((url) => navigateTo(url));
    window.nexus.tabs.onOpenNewTab?.((url) => createTab(url));

    // ─── Browser Automation Bridge ────────────────────────────────
    
    window.nexus.tabs.onSnapshotRequest?.((_) => {
        const webview = document.getElementById(`webview-${state.activeTabId}`);
        if (!webview) {
            window.nexus.tabs.sendSnapshotResult({ success: true, snapshot: { title: 'New Tab', url: 'nexus://newtab', elements: [], summary: 'On new tab page.' } });
            return;
        }
        fetch('js/domDistiller.js').then(res => res.text()).then(script => {
            webview.executeJavaScript(script).then(result => {
                // Ensure painting completes before capture
                setTimeout(async () => {
                    try {
                        const image = await webview.capturePage();
                        result.image = image.toDataURL(); // data:image/png;base64,...
                        window.nexus.tabs.sendSnapshotResult({ success: true, snapshot: result });
                    } catch (err) {
                        console.error('Snapshot visual capture failed', err);
                        window.nexus.tabs.sendSnapshotResult({ success: true, snapshot: result });
                    }
                }, 150); // slight delay to allow overlay boxes to render visually
            }).catch(err => {
                window.nexus.tabs.sendSnapshotResult({ success: false, error: err.message });
            });
        });
    });

    window.nexus.tabs.onInteractRequest?.((_, { action, data }) => {
        const webview = document.getElementById(`webview-${state.activeTabId}`);
        if (!webview) return;
        let script = '';
        if (action === 'click') { script = `window.nexusInteract.click("${data.id}")`; showToast(`Nexus is clicking ${data.id}...`, 'info'); }
        else if (action === 'type') { script = `window.nexusInteract.type("${data.id}", "${data.text}")`; showToast(`Nexus is typing...`, 'info'); }
        else if (action === 'scroll') { script = `window.nexusInteract.scroll("${data.direction}")`; }
        webview.executeJavaScript(script).then(result => { window.nexus.tabs.sendInteractResult({ success: result }); }).catch(err => { window.nexus.tabs.sendInteractResult({ success: false, error: err.message }); });
    });

    if (elements.newTabSearch) {
        elements.newTabSearch.onkeydown = (e) => { 
            if (e.key === 'Enter') navigateTo('https://www.google.com/search?q=' + encodeURIComponent(elements.newTabSearch.value)); 
        };
    }
    document.querySelectorAll('.newtab__shortcut').forEach(sc => { 
        sc.onclick = () => navigateTo(sc.getAttribute('data-url')); 
    });

    // ─── Window Controls ──────────────────────────────────────────
    
    // ─── Window Controls (Safe Mode) ──────────────────────────
    const safeAssignClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
        else console.warn(`[NEXUS:STABILITY] Optional UI element not found: ${id}`);
    };

    safeAssignClick('btn-minimize', () => window.nexus.window.minimize());
    safeAssignClick('btn-maximize', () => window.nexus.window.maximize());
    safeAssignClick('btn-close', () => window.nexus.window.close());

    // ─── Native AI Browser Commands ───────────────────────────────
    
    window.nexus.tabs.onCloseTabsCommand?.((_, direction) => {
        const activeIdx = state.tabs.findIndex(t => t.id === state.activeTabId);
        if (activeIdx === -1) return;
        
        let toClose = [];
        if (direction === 'right') toClose = state.tabs.slice(activeIdx + 1);
        else if (direction === 'left') toClose = state.tabs.slice(0, activeIdx);
        else if (direction === 'other') toClose = state.tabs.filter(t => t.id !== state.activeTabId);
        
        toClose.forEach(t => closeTab(t.id));
        showToast(`AI closed tabs to the ${direction}`, 'info');
    });

    window.nexus.tabs.onBookmarkCommand?.(() => {
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        if (tab && tab.url !== 'nexus://newtab') {
            window.nexus.bookmarks.add({ title: tab.title, url: tab.url });
            showToast('AI bookmarked this page', 'success');
        }
    });

    window.nexus.settings.onSetThemeCommand?.((_, mode) => {
        document.body.setAttribute('data-theme', mode); // Simple toggle
        showToast(`AI set theme to ${mode}`, 'info');
    });

    // ─── Initialization ───────────────────────────────────────────
    
    try {
        createTab();
    } catch (err) {
        console.error('[NEXUS:STABILITY] Initial createTab failed, suppressing to allow AI modules:', err);
    }

    const initModule = (name, initFn) => {
        console.log('[NEXUS] Initializing module:', name);
        try {
            initFn();
        } catch (e) {
            console.error(`[NEXUS] Failed to init ${name}:`, e);
        }
    }


    // ─── Priority System Check (Always start AI first) ────────────
    initModule('Chat', initChat);
    initModule('Agents', initAgents);
    initModule('Notes', initNotes);
    // Settings and Bookmarks are now handled by the modular Platform Services and about: pages.

    // Initial Data Fetch
    setTimeout(() => {
        if (window.loadNexusModels) window.loadNexusModels();
        if (window.loadAgents) window.loadAgents();
    }, 500);

    console.log('[NEXUS] Systems Check: Nominal. Multi-Model Engine Active.');

    // ─── Module Definitions (Hoisted) ─────────────────────────────

    function initChat() {
        const input = document.getElementById('chat-input');
        const send = document.getElementById('chat-send');
        const stopBtn = document.getElementById('chat-stop');
        const messagesEl = document.getElementById('chat-messages');
        const contextBtn = document.getElementById('chat-context-btn');
        
        let sessionMessages = [];
        let activeChatId = null;
        let currentBubble = null;
        let currentStreamText = '';
        let contextEnabled = false;

        if (contextBtn) {
            contextBtn.onclick = () => {
                contextEnabled = !contextEnabled;
                contextBtn.classList.toggle('active', contextEnabled);
                contextBtn.style.color = contextEnabled ? 'var(--accent)' : 'var(--text-muted)';
                contextBtn.style.background = contextEnabled ? 'var(--accent-subtle)' : 'transparent';
                showToast(`AI Context Reading: ${contextEnabled ? 'ON' : 'OFF'}`, 'info');
            };
        }

        function addMessage(role, content) {
            if (!messagesEl) return null;
            const msg = document.createElement('div');
            msg.className = `chat__message chat__message--${role}`;
            const avatar = role === 'ai' ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>' : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
            msg.innerHTML = `<div class="chat__avatar chat__avatar--${role}">${avatar}</div><div class="chat__bubble">${content}</div>`;
            messagesEl.appendChild(msg);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            return msg;
        }

        // --- Persistent Persistent Listeners ---
        window.nexus.llm.onChunk(({ chatId, chunk }) => {
            if (chatId !== activeChatId) return;
            currentStreamText += chunk;
            if (currentBubble) currentBubble.innerText = currentStreamText;
            messagesEl.scrollTop = messagesEl.scrollHeight;
        });

        const cleanup = (chatId) => {
            if (chatId !== activeChatId) return;
            if (stopBtn) stopBtn.classList.add('hidden');
            if (send) send.classList.remove('hidden');
        };

        window.nexus.llm.onDone(({ chatId }) => {
            if (chatId !== activeChatId) return;
            sessionMessages.push({ role: 'assistant', content: currentStreamText });
            cleanup(chatId);
        });

        window.nexus.llm.onError(({ chatId, error }) => {
            if (chatId !== activeChatId) return;
            if (currentBubble) currentBubble.innerText = `Error: ${error}`;
            cleanup(chatId);
        });

        processChat = async function() {
            try {
                const text = input.value?.trim();
                if (!text) return;
                
                input.value = '';
                
                // Clean up old state
                currentStreamText = '';
                activeChatId = 'chat-' + Date.now();
                console.log(`TRACE: Initializing session: ${activeChatId}`);
                
                addMessage('user', text);
                const aiMsg = addMessage('ai', 'Thinking...');
                if (!aiMsg) throw new Error('UI failed to render message bubble');
                
                currentBubble = aiMsg.querySelector('.chat__bubble');

                if (stopBtn) stopBtn.classList.remove('hidden');
                if (send) send.classList.add('hidden');

                if (contextEnabled) {
                    console.log('TRACE: Context enabled. Fetching snapshot...');
                    const snap = await window.nexus.tabs.getSnapshot();
                    if (snap && snap.success && snap.snapshot) {
                        sessionMessages.push({ role: 'system', content: `CRITICAL CONTEXT: You are looking at the page "${snap.snapshot.title}". URL: ${snap.snapshot.url}. Here is the distilled summary of the page: ${snap.snapshot.summary}` });
                        showToast('AI read page context...', 'info');
                    }
                }
                sessionMessages.push({ role: 'user', content: text });

                const modelSelect = document.getElementById('chat-model-select');
                let model = modelSelect?.value;
                console.log(`TRACE: Selected model from UI: ${model || 'DEFAULT'}`);
                
                // Final safety: if model is empty string (Loading/Offline), fallback to settings
                if (!model) {
                    console.log('TRACE: Model is empty, fetching native settings fallback...');
                    const currentSettings = await window.nexus.settings.get();
                    const provider = currentSettings.provider || 'openrouter';
                    model = provider === 'openrouter' ? currentSettings.openrouterModel : (provider === 'ollama' ? currentSettings.ollamaModel : currentSettings.pollinationsModel);
                    console.log(`TRACE: Fallback model resolved: ${model}`);
                }

                const currentSettings = await window.nexus.settings.get();
                const ignitionDelay = currentSettings.timeout || 300;

                setTimeout(() => {
                    console.log(`TRACE: Dispatching stream request to IPC bridge for ${activeChatId}...`);
                    window.nexus.llm.stream(activeChatId, sessionMessages, model);
                    console.log('TRACE: IPC stream call dispatched successfully.');
                }, ignitionDelay);
            } catch (err) {
                console.log(`TRACE: FATAL ERROR in processChat: ${err.message}`);
                console.error('[NEXUS:UI] processChat failed:', err);
                showToast(`Chat Error: ${err.message}`, 'danger');
                if (send) send.classList.remove('hidden');
                if (stopBtn) stopBtn.classList.add('hidden');
            }
        };

        if (send) {
            send.onclick = (e) => {
                e.stopImmediatePropagation(); // Core fix: prevent global interceptor double-fire
                processChat();
            };
        }
        if (stopBtn) {
            stopBtn.onclick = (e) => {
                e.stopImmediatePropagation();
                window.nexus.llm.stop(activeChatId);
                if (currentBubble) currentBubble.innerText += ' [Stopped]';
                cleanup(activeChatId);
            };
        }
        if (input) {
            input.onkeydown = (e) => { 
                if (e.key === 'Enter' && !e.shiftKey) { 
                    e.preventDefault(); 
                    e.stopImmediatePropagation();
                    processChat(); 
                } 
            };
        }
    }

    function initAgents() {
        const list = document.getElementById('agent-list');
        const createBtn = document.getElementById('btn-create-agent');
        if (createBtn) createBtn.onclick = () => handleCreateAgent();

        async function load() {
            const agents = await window.nexus.agents.get();
            if (agents.length === 0) list.innerHTML = '<div class="empty-state">No Agents found.</div>';
            else list.innerHTML = agents.map(a => `
                <div class="agent-card" id="agent-${a.id}">
                    <div class="agent-card__header">
                        <div class="agent-card__avatar">${a.emoji || '🤖'}</div>
                        <div class="agent-card__info">
                            <div class="agent-card__name">${a.name}</div>
                            <div class="agent-card__desc">${a.description || ''}</div>
                        </div>
                    </div>
                    <div class="agent-card__actions">
                        <button class="btn btn-primary btn-sm btn-run" data-id="${a.id}">Run</button>
                        <button class="btn btn-danger btn-sm btn-stop hidden" id="stop-${a.id}" data-id="${a.id}">Stop</button>
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
        // We listen globally once to prevent duplicate log entries
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
            const logContainer = document.getElementById(`log-${agentId}`);

            if (card) card.classList.remove('running');
            if (stopBtn) stopBtn.classList.add('hidden');
            if (runBtn) runBtn.classList.remove('hidden');
            if (interaction) interaction.classList.add('hidden');
            
            if (logContainer) {
                logContainer.classList.remove('hidden');
                const errEl = document.createElement('div');
                errEl.className = 'agent-log__step agent-log__step--error';
                errEl.innerText = `FATAL ERROR: ${error}`;
                logContainer.appendChild(errEl);
                logContainer.scrollTop = logContainer.scrollHeight;
            }
        });

        load();
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

    function initNotes() {
        const list = document.getElementById('note-list');
        window.loadNotes = async () => {
            const notes = await window.nexus.notes.get();
            list.innerHTML = notes.map(n => `<div class="note-card" onclick="window.editNote('${n.id}')"><div>${n.title}</div><small>${n.content.substring(0,30)}...</small></div>`).join('');
        };
        window.editNote = async (id) => {
            const notes = await window.nexus.notes.get();
            const n = notes.find(i => i.id === id) || {title:'', content:''};
            const res = await showModal('Note', [{id:'title',label:'Title',value:n.title},{id:'content',label:'Content',type:'textarea',value:n.content}]);
            if (res) { await window.nexus.notes.save({id, ...res}); window.loadNotes(); }
        };
        window.loadNotes();
    }





    function initImageGen() {
        const promptInput = document.getElementById('imagegen-prompt');
        const sendBtn = document.getElementById('imagegen-send');
        const gallery = document.getElementById('imagegen-gallery');
        
        if (!promptInput || !sendBtn || !gallery) return;

        sendBtn.addEventListener('click', () => {
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
            card.style.backgroundColor = 'var(--surface)';
            card.style.minHeight = '200px';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.alignItems = 'center';
            card.style.justifyContent = 'center';
            card.style.boxShadow = 'var(--shadow-sm)';
            
            const loader = document.createElement('div');
            loader.innerText = 'Generating image... ✨';
            loader.style.color = 'var(--text-muted)';
            loader.style.fontSize = '12px';
            loader.style.fontWeight = '500';
            card.appendChild(loader);
            
            // Prepend new card to gallery
            gallery.prepend(card);

            // Fetch natively via img tag connected to pollinations AI
            // Adds random seed to bypass caching between generations
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
                card.style.minHeight = 'auto'; // Let it size to the image
                card.appendChild(img);
                img.style.opacity = '1';
                
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'btn btn-primary';
                downloadBtn.style.position = 'absolute';
                downloadBtn.style.bottom = '12px';
                downloadBtn.style.right = '12px';
                downloadBtn.style.padding = '8px 16px';
                downloadBtn.style.fontSize = '12px';
                downloadBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                downloadBtn.style.zIndex = '10';
                downloadBtn.innerText = 'Download';
                
                downloadBtn.onclick = async () => {
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
                        if (window.showToast) window.showToast('Image downloaded!', 'success');
                    } catch(e) {
                        console.error('Download failed', e);
                        if (window.showToast) window.showToast('Download failed', 'error');
                    }
                    downloadBtn.innerText = originalText;
                };

                card.appendChild(downloadBtn);
            };

            img.onerror = () => {
                loader.innerText = 'Failed to generate image. Please try again.';
                loader.style.color = 'var(--danger)';
            };

            img.src = imgUrl; // Triggers browser network request
        });
        
        promptInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendBtn.click();
            }
        });
    }

    // Call init routines
    initImageGen();


}); // Real End of DOMContentLoaded
