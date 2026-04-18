'use strict';

const { ipcMain } = require('electron');

class Service {
    constructor(hub, identifier) {
        this.hub = hub;
        this.id = identifier;
        this.handlers = {};
    }

    /**
     * Called by the Hub during initialization.
     * Override this to perform startup tasks (DB connections, etc.)
     */
    async init() {
        // To be overridden
    }

    /**
     * Register an IPC handler for this service.
     * Use this in the init method.
     */
    handle(name, fn) {
        const channel = `${this.id}:${name}`;
        this.handlers[name] = fn;
        ipcMain.handle(channel, (event, ...args) => fn.call(this, event, ...args));
    }

    /**
     * Send an event to all open renderer windows.
     */
    send(channel, data) {
        this.hub.broadcast(`${this.id}:${channel}`, data);
    }

    log(msg) {
        console.log(`[PLATFORM:${this.id.toUpperCase()}] ${msg}`);
    }
}

module.exports = Service;
