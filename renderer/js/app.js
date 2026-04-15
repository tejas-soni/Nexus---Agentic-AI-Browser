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

    let availableModels = [];

    async function loadAvailableModels() {
        const chatModelSelect = document.getElementById('chat-model-select');
        if (chatModelSelect) chatModelSelect.innerHTML = '<option value="">Fetching brains...</option>';
        
        const res = await window.nexus.settings.fetchModels();
        if (res.success) {
            availableModels = res.models;
            if (chatModelSelect) {
                chatModelSelect.innerHTML = availableModels.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
            }
        } else {
            console.error('[NEXUS:UI] Model fetch failed:', res.error);
            if (chatModelSelect) chatModelSelect.innerHTML = '<option value="">Provider disconnected</option>';
        }
    }
    window.loadNexusModels = loadAvailableModels;

    // ─── OVERKILL STABILITY FIX: Global Agent/Note Handlers ──────
    // This catches clicks for ALL dynamic elements even after re-renders.
    document.addEventListener('click', async (e) => {
        const target = e.target;
        const btn = target.closest('button');
        if (!btn) return;

        console.log('[NEXUS] Click Intercept:', btn.id || btn.className);

        // --- Agents ---
        if (btn.id === 'btn-create-agent') {
            handleCreateAgent();
        } else if (btn.classList.contains('btn-run')) {
            handleRunAgent(btn.getAttribute('data-id'));
        } else if (btn.classList.contains('btn-stop')) {
            handleStopAgent(btn.getAttribute('data-id'));
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
        webviewContainer: document.getElementById('webview-container'),
        newTabPage: document.getElementById('newtab-page'),
        newTabSearch: document.getElementById('newtab-search'),
        rightPanel: document.getElementById('right-panel'),
        btnAiToggle: document.getElementById('btn-ai-toggle'),
        navItems: document.querySelectorAll('.sidebar__item'),
        panelSections: document.querySelectorAll('.panel-section'),
        closeBtns: document.querySelectorAll('.panel-header__close'),
        toastContainer: document.getElementById('toast-container')
    };

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

    elements.navItems.forEach(item => {
        item.onclick = () => {
            const panel = item.getAttribute('data-panel');
            if (panel === 'home') {
                closeAllPanels();
                showNewTabPage();
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
        const tab = { id, url: url || 'nexus://newtab', title: 'New Tab', loading: false, favicon: null };
        state.tabs.push(tab);
        renderTabs();
        if (url && url !== 'nexus://newtab') {
            const webview = document.createElement('webview');
            webview.id = `webview-${id}`;
            webview.src = url;
            webview.setAttribute('allowpopups', '');
            elements.webviewContainer.appendChild(webview);
            setupWebviewEvents(webview, id);
        }
        switchTab(id);
        return id;
    }

    function setupWebviewEvents(webview, tabId) {
        webview.addEventListener('did-start-loading', () => {
            const tab = state.tabs.find(t => t.id === tabId);
            if (tab) { tab.loading = true; renderTabs(); }
        });
        webview.addEventListener('did-stop-loading', () => {
            const tab = state.tabs.find(t => t.id === tabId);
            if (tab) {
                tab.loading = false;
                tab.title = webview.getTitle();
                tab.url = webview.getURL();
                renderTabs();
                if (state.activeTabId === tabId) {
                    elements.urlInput.value = tab.url;
                    updateNavButtons(webview);
                }
                window.nexus.history.add({ title: tab.title, url: tab.url, favicon: tab.favicon });
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
        webview.addEventListener('new-window', (e) => createTab(e.url));
    }

    function switchTab(id) {
        state.activeTabId = id;
        const tab = state.tabs.find(t => t.id === id);
        renderTabs();
        document.querySelectorAll('webview').forEach(wv => wv.style.display = 'none');
        elements.newTabPage.style.display = 'none';
        if (tab.url === 'nexus://newtab') {
            elements.newTabPage.style.display = 'flex';
            elements.urlInput.value = '';
        } else {
            const webview = document.getElementById(`webview-${id}`);
            if (webview) {
                webview.style.display = 'flex';
                elements.urlInput.value = webview.getURL();
                updateNavButtons(webview);
            }
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
        const tab = state.tabs.find(t => t.id === state.activeTabId);
        if (tab) {
            tab.url = 'nexus://newtab'; tab.title = 'New Tab'; tab.favicon = null;
            const webview = document.getElementById(`webview-${tab.id}`);
            if (webview) webview.remove();
            switchTab(tab.id);
        }
    }

    // ─── Navigation Logic ─────────────────────────────────────────

    function updateNavButtons(webview) {
        elements.btnBack.disabled = !webview.canGoBack();
        elements.btnForward.disabled = !webview.canGoForward();
    }

    function navigateTo(url) {
        let tab = state.tabs.find(t => t.id === state.activeTabId);
        tab.url = url;
        let webview = document.getElementById(`webview-${tab.id}`);
        if (!webview) {
            webview = document.createElement('webview');
            webview.id = `webview-${tab.id}`; webview.setAttribute('allowpopups', '');
            elements.webviewContainer.appendChild(webview);
            setupWebviewEvents(webview, tab.id);
        }
        webview.src = url;
        switchTab(tab.id);
    }

    elements.btnBack.onclick = () => { const wv = document.getElementById(`webview-${state.activeTabId}`); if (wv) wv.goBack(); };
    elements.btnForward.onclick = () => { const wv = document.getElementById(`webview-${state.activeTabId}`); if (wv) wv.goForward(); };
    elements.btnReload.onclick = () => { const tab = state.tabs.find(t => t.id === state.activeTabId); if (tab.url !== 'nexus://newtab') { const wv = document.getElementById(`webview-${state.activeTabId}`); if (wv) wv.reload(); } };

    elements.urlInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
            let val = elements.urlInput.value.trim();
            if (!val) return;
            if (!val.includes('://') && !val.startsWith('nexus://')) {
                if (val.includes('.') && !val.includes(' ')) val = 'https://' + val;
                else val = 'https://www.google.com/search?q=' + encodeURIComponent(val);
            }
            navigateTo(val);
        }
    };

    elements.btnNewTab.onclick = () => createTab();
    window.nexus.tabs.onOpenUrl((url) => navigateTo(url));

    // ─── Browser Automation Bridge ────────────────────────────────
    
    window.nexus.tabs.onSnapshotRequest?.((_) => {
        const webview = document.getElementById(`webview-${state.activeTabId}`);
        if (!webview) {
            window.nexus.tabs.sendSnapshotResult({ success: true, snapshot: { title: 'New Tab', url: 'nexus://newtab', elements: [], summary: 'On new tab page.' } });
            return;
        }
        fetch('js/domDistiller.js').then(res => res.text()).then(script => {
            webview.executeJavaScript(script).then(result => { window.nexus.tabs.sendSnapshotResult({ success: true, snapshot: result }); }).catch(err => { window.nexus.tabs.sendSnapshotResult({ success: false, error: err.message }); });
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

    elements.newTabSearch.onkeydown = (e) => { if (e.key === 'Enter') navigateTo('https://www.google.com/search?q=' + encodeURIComponent(elements.newTabSearch.value)); };
    document.querySelectorAll('.newtab__shortcut').forEach(sc => { sc.onclick = () => navigateTo(sc.getAttribute('data-url')); });

    // ─── Window Controls ──────────────────────────────────────────
    
    document.getElementById('btn-minimize').onclick = () => window.nexus.window.minimize();
    document.getElementById('btn-maximize').onclick = () => window.nexus.window.maximize();
    document.getElementById('btn-close').onclick = () => window.nexus.window.close();

    // ─── Initialization ───────────────────────────────────────────
    
    createTab();

    const initModule = (name, initFn) => {
        console.log('[NEXUS] Initializing module:', name);
        try {
            initFn();
        } catch (e) {
            console.error(`[NEXUS] Failed to init ${name}:`, e);
        }
    }

    // ─── Safety Shield ───
    function nexusLog(msg) {
        if (window.nexus && window.nexus.log) {
            window.nexus.log(msg);
        }
        console.log(`[NEXUS:UI] ${msg}`);
    }

    initModule('Chat', initChat);
    initModule('Agents', initAgents);
    initModule('Notes', initNotes);
    initModule('Settings', initSettings);
    initModule('Bookmarks', initBookmarks);

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
        
        let sessionMessages = [];
        let activeChatId = null;
        let currentBubble = null;
        let currentStreamText = '';

        function addMessage(role, content) {
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
            nexusLog(`Chunk received for ${chatId}`);
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
            nexusLog(`Done: ${chatId}`);
            if (chatId !== activeChatId) return;
            sessionMessages.push({ role: 'assistant', content: currentStreamText });
            cleanup(chatId);
        });

        window.nexus.llm.onError(({ chatId, error }) => {
            nexusLog(`Error for ${chatId}: ${error}`);
            if (chatId !== activeChatId) return;
            if (currentBubble) currentBubble.innerText = `Error: ${error}`;
            cleanup(chatId);
        });

        async function processChat() {
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            
            // Clean up old state
            currentStreamText = '';
            activeChatId = 'chat-' + Date.now();
            nexusLog(`Starting session: ${activeChatId}`);
            
            addMessage('user', text);
            const aiMsg = addMessage('ai', 'Thinking...');
            currentBubble = aiMsg.querySelector('.chat__bubble');

            if (stopBtn) stopBtn.classList.remove('hidden');
            if (send) send.classList.add('hidden');

            const snap = await window.nexus.tabs.getSnapshot();
            if (snap.success && snap.snapshot) {
                sessionMessages.push({ role: 'system', content: `[User is viewing: ${snap.snapshot.title} at ${snap.snapshot.url}. Summary: ${snap.snapshot.summary}]` });
            }
            sessionMessages.push({ role: 'user', content: text });

            const model = document.getElementById('chat-model-select')?.value;
            window.nexus.llm.stream(activeChatId, sessionMessages, model);
        }

        send.onclick = processChat;
        if (stopBtn) stopBtn.onclick = () => {
            window.nexus.llm.stop(activeChatId);
            if (currentBubble) currentBubble.innerText += ' [Stopped]';
            cleanup(activeChatId);
        };
        input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); processChat(); } };
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
                        <div class="agent-card__info"><div class="agent-card__name">${a.name}</div><div class="agent-card__desc">${a.description || ''}</div></div>
                    </div>
                    <div class="agent-card__actions">
                        <button class="btn btn-primary btn-sm btn-run" data-id="${a.id}">Run</button>
                        <button class="btn btn-danger btn-sm btn-stop hidden" id="stop-${a.id}" data-id="${a.id}">Stop</button>
                        <button class="btn btn-ghost btn-sm btn-edit" data-id="${a.id}">Edit</button>
                        <button class="btn btn-danger btn-sm btn-delete" data-id="${a.id}">Delete</button>
                    </div>
                    <div class="agent-log hidden" id="log-${a.id}"></div>
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
            if (card) card.classList.remove('running');
            if (stopBtn) stopBtn.classList.add('hidden');
            if (runBtn) runBtn.classList.remove('hidden');
        });

        window.nexus.agents.onError(({ agentId, error }) => {
            showToast(`Agent Error: ${error}`, 'error');
            const card = document.getElementById(`agent-${agentId}`);
            const stopBtn = document.getElementById(`stop-${agentId}`);
            const runBtn = card?.querySelector('.btn-run');
            if (card) card.classList.remove('running');
            if (stopBtn) stopBtn.classList.add('hidden');
            if (runBtn) runBtn.classList.remove('hidden');
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
        nexusLog(`Running Agent: ${agent.name} with model: ${model}`);
        
        const card = document.getElementById(`agent-${id}`);
        const stopBtn = document.getElementById(`stop-${id}`);
        const runBtn = card?.querySelector('.btn-run');
        if (card) {
            card.classList.add('running');
            const log = document.getElementById(`log-${id}`);
            if (log) { log.innerHTML = ''; log.classList.remove('hidden'); }
        }
        if (stopBtn) stopBtn.classList.remove('hidden');
        if (runBtn) runBtn.classList.add('hidden');

        showToast(`Agent ${agent.name} started running...`, 'success');
        window.nexus.agents.run({ agentId: id, goal: task, tabId: null, model: model });
    }

    async function handleStopAgent(id) {
        await window.nexus.agents.stop(id);
        const card = document.getElementById(`agent-${id}`);
        const stopBtn = document.getElementById(`stop-${id}`);
        const runBtn = card?.querySelector('.btn-run');
        if (card) card.classList.remove('running');
        if (stopBtn) stopBtn.classList.add('hidden');
        if (runBtn) runBtn.classList.remove('hidden');
        showToast('Agent stopped.', 'info');
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

    async function initSettings() {
        const body = document.getElementById('settings-body');
        const s = await window.nexus.settings.get();

        body.innerHTML = `
            <div class="settings-form">
                <div class="input-field">
                    <label class="input-label">AI Provider</label>
                    <select class="input" id="set-provider">
                        <option value="openrouter" ${s.provider === 'openrouter' ? 'selected' : ''}>OpenRouter (Cloud)</option>
                        <option value="ollama" ${s.provider === 'ollama' ? 'selected' : ''}>Ollama (Local)</option>
                        <option value="pollinations" ${s.provider === 'pollinations' ? 'selected' : ''}>Pollinations (Free AI)</option>
                    </select>
                </div>
                <div class="input-field provider-group provider-openrouter">
                    <label class="input-label">OpenRouter API Key</label>
                    <input class="input" type="password" id="set-openrouterApiKey" value="${s.openrouterApiKey || ''}" placeholder="sk-or-v1-...">
                </div>
                <div class="input-field provider-group provider-ollama">
                    <label class="input-label">Ollama URL</label>
                    <input class="input" type="text" id="set-ollamaBaseUrl" value="${s.ollamaBaseUrl || 'http://localhost:11434'}" placeholder="http://localhost:11434">
                </div>
                <div class="input-field provider-group provider-pollinations">
                    <label class="input-label">Pollinations API Key (Optional)</label>
                    <input class="input" type="password" id="set-pollinationsApiKey" value="${s.pollinationsApiKey || ''}" placeholder="Leave blank for free usage...">
                    <small style="color:var(--text-muted);font-size:10px;margin-top:4px">Add an API key to increase your Pollinations Text AI request limits or bypass captchas.</small>
                </div>
                <div class="input-field">
                    <label class="input-label">Response Timeout (Seconds)</label>
                    <input class="input" type="number" id="set-timeout" value="${s.timeout || 300}" min="10" max="1800">
                    <small style="color:var(--text-muted);font-size:10px;margin-top:4px">Increase this if your CPU is slow with local models. Default is 300s (5m).</small>
                </div>
                <div class="settings-actions" style="display:flex;gap:12px;margin-top:16px;">
                    <button class="btn btn-ghost" id="btn-test-settings" style="flex:1">Test Connection</button>
                    <button class="btn btn-primary" id="btn-save-settings" style="flex:2">Save Configuration</button>
                </div>
            </div>
            <style>
                .provider-group { display: none; }
                .provider-openrouter { display: ${s.provider === 'openrouter' || !s.provider ? 'block' : 'none'}; }
                .provider-ollama { display: ${s.provider === 'ollama' ? 'block' : 'none'}; }
                .provider-pollinations { display: ${s.provider === 'pollinations' ? 'block' : 'none'}; }
            </style>
        `;

        const providerSelect = body.querySelector('#set-provider');
        providerSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            body.querySelectorAll('.provider-group').forEach(el => el.style.display = 'none');
            body.querySelectorAll('.provider-' + val).forEach(el => el.style.display = 'block');
        });

        const saveBtn = body.querySelector('#btn-save-settings');
        const testBtn = body.querySelector('#btn-test-settings');

        const getFormData = () => ({
            provider: body.querySelector('#set-provider').value,
            openrouterApiKey: body.querySelector('#set-openrouterApiKey').value,
            ollamaBaseUrl: body.querySelector('#set-ollamaBaseUrl').value,
            pollinationsApiKey: body.querySelector('#set-pollinationsApiKey').value,
            timeout: parseInt(body.querySelector('#set-timeout').value)
        });

        testBtn.onclick = async () => {
            testBtn.disabled = true;
            testBtn.innerText = 'Testing...';
            const current = getFormData();
            
            // Temporary save so backend uses these during fetch
            await window.nexus.settings.save(current);
            const res = await window.nexus.settings.fetchModels();
            
            if (res.success) {
                showToast(`Connection Successful! Found ${res.models.length} brains.`, 'success');
                if (window.loadNexusModels) window.loadNexusModels();
            } else {
                showToast(`Connection Failed: ${res.error}`, 'error');
            }
            testBtn.disabled = false;
            testBtn.innerText = 'Test Connection';
        };

        saveBtn.onclick = async () => {
            await window.nexus.settings.save(getFormData());
            showToast('Settings saved successfully!', 'success');
            if (window.loadNexusModels) window.loadNexusModels();
        };
    }

    function initBookmarks() {
        const list = document.getElementById('bookmark-list');
        async function load() {
            const bms = await window.nexus.bookmarks.get();
            if (list) list.innerHTML = bms.map(b => `<div class="note-card"><div>${b.title}</div><small>${b.url}</small></div>`).join('');
        }
        load();
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
