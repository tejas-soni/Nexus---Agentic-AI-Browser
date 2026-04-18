'use strict';

const { protocol, BrowserWindow, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

class Hub {
    constructor() {
        this.services = new Map();
    }

    registerService(id, ServiceClass) {
        const service = new ServiceClass(this, id);
        this.services.set(id, service);
        return service;
    }

    async init() {
        console.log('[PLATFORM:HUB] Initializing global platform services...');
        
        // Register nexus:// and about: protocols
        this.setupProtocols();

        // Initialize all registered services
        for (const service of this.services.values()) {
            await service.init();
        }
    }

    setupProtocols() {
        // Handle nexus:// requests
        protocol.handle('nexus', (request) => {
            const urlObj = new URL(request.url);
            let rawPath = urlObj.pathname === '/' ? urlObj.host : urlObj.host + urlObj.pathname;
            rawPath = rawPath.replace(/^\/+|\/+$/g, '');
            if (!rawPath || rawPath === 'newtab' || rawPath === 'index') rawPath = 'newtab';

            // Intelligent Asset Recognition
            // If the path contains a standard renderer directory (css, js, etc.), 
            // we should treat it as an asset relative to the renderer root.
            const assetDirs = ['css', 'js', 'assets', 'icons', 'fonts'];
            const segments = rawPath.split('/');
            
            // Look for the last occurrence of an asset directory to handle paths like 'newtab/css/style.css'
            const assetDirIndex = segments.findLastIndex(seg => assetDirs.includes(seg.toLowerCase()));
            
            const isAsset = assetDirIndex !== -1 || path.extname(rawPath) !== '';
            
            let relativePath;
            if (assetDirIndex !== -1) {
                // If an asset directory was found, serve everything from that directory onwards
                const assetPath = segments.slice(assetDirIndex).join('/');
                relativePath = path.join('..', '..', 'renderer', assetPath);
            } else if (path.extname(rawPath)) {
                // If it has an extension but no asset dir, serve from renderer root
                relativePath = path.join('..', '..', 'renderer', rawPath);
            } else {
                // Otherwise, treat as an internal page in /pages
                relativePath = path.join('..', '..', 'renderer', 'pages', rawPath + '.html');
            }

            let filepath = path.resolve(__dirname, relativePath);
            
            // Fallback for missing pages
            if (!path.extname(rawPath) && !fs.existsSync(filepath)) {
                console.warn(`[PLATFORM:HUB] Page not found: ${rawPath}. Falling back to newtab.`);
                filepath = path.resolve(__dirname, '..', '..', 'renderer', 'pages', 'newtab.html');
            }

            const fileUrl = pathToFileURL(filepath).toString();
            console.log(`[PLATFORM:HUB] nexus:// Protocol: ${request.url} -> ${fileUrl}`);
            
            return net.fetch(fileUrl);
        });

        // Also handle about: if configured as a standard scheme
        // (Usually we just alias it to nexus:// in the UI for simplicity)
    }

    broadcast(channel, data) {
        BrowserWindow.getAllWindows().forEach(win => {
            win.webContents.send(channel, data);
        });
    }

    getService(id) {
        return this.services.get(id);
    }
}

module.exports = new Hub();
