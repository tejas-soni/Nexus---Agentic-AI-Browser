'use strict';

const Service = require('./Service');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
const { session } = require('electron');
const Store = require('electron-store');

class ShieldsService extends Service {
    constructor(hub, id) {
        super(hub, id);
        this.store = new Store({ name: 'nexus-shields' });
        this.blocker = null;
        this.stats = { blockedCount: 0 };
    }

    async init() {
        this.log('Initializing Privacy Engine...');
        
        try {
            this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
            this.blocker.enableBlockingInSession(session.defaultSession);
            this.log('Ad-blocker engine ready.');
        } catch (e) {
            this.error('Failed to load ad-blocker engine: ' + e.message);
        }

        this.setupRequestHandlers();
        this.setupHandlers();
    }

    setupRequestHandlers() {
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
            const url = new URL(details.url);
            const domain = url.hostname;
            const config = this.getDomainConfig(domain);

            // 1. Check if Shields are OFF for this domain
            if (config.enabled === false) {
                return callback({ cancel: false });
            }

            // 2. HTTPS Upgrade (if HTTP and upgrade enabled)
            if (url.protocol === 'http:' && config.httpsUpgrade !== false) {
                this.log(`Upgrading to HTTPS: ${details.url}`);
                return callback({ redirectURL: details.url.replace('http:', 'https:') });
            }

            // Ad-blocker handles the rest via enableBlockingInSession
            callback({ cancel: false });
        });

        // Track blocking events to update UI stats
        if (this.blocker) {
            this.blocker.on('request-blocked', (request) => {
                this.stats.blockedCount++;
                this.send('stats-update', { total: this.stats.blockedCount });
            });
        }
    }

    setupHandlers() {
        this.handle('get-config', (event, domain) => {
            return this.getDomainConfig(domain);
        });

        this.handle('save-config', (event, { domain, config }) => {
            const current = this.store.get(domain, { enabled: true, httpsUpgrade: true, fingerprinting: true });
            const updated = { ...current, ...config };
            this.store.set(domain, updated);
            this.log(`Config updated for ${domain}`);
            return updated;
        });

        this.handle('get-stats', () => {
            return this.stats;
        });
    }

    getDomainConfig(domain) {
        // Default: Shields ON, HTTPS Upgrade ON, Fingerprinting Protection ON
        return this.store.get(domain, {
            enabled: true,
            httpsUpgrade: true,
            fingerprinting: true
        });
    }

    error(msg) {
        console.error(`[PLATFORM:SHIELDS] ${msg}`);
    }
}

module.exports = ShieldsService;
