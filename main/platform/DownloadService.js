'use strict';

const Service = require('./Service');
const { session, shell } = require('electron');
const path = require('path');

class DownloadService extends Service {
    constructor(hub, id) {
        super(hub, id);
        this.downloads = new Map(); // id -> item data
    }

    async init() {
        this.log('Initializing Downloads...');
        
        session.defaultSession.on('will-download', (event, item, webContents) => {
            const id = Date.now().toString();
            const fileName = item.getFilename();
            const totalBytes = item.getTotalBytes();
            
            // Set default save path if needed, or let system dialog handle it
            
            const downloadInfo = {
                id,
                name: fileName,
                path: '',
                total: totalBytes,
                received: 0,
                status: 'downloading',
                startTime: Date.now()
            };

            this.downloads.set(id, downloadInfo);
            this.send('update', downloadInfo);

            item.on('updated', (event, state) => {
                if (state === 'interrupted') {
                    downloadInfo.status = 'interrupted';
                } else if (state === 'progressing') {
                    if (item.isPaused()) {
                        downloadInfo.status = 'paused';
                    } else {
                        downloadInfo.status = 'downloading';
                        downloadInfo.received = item.getReceivedBytes();
                        downloadInfo.path = item.getSavePath();
                    }
                }
                this.send('update', downloadInfo);
            });

            item.once('done', (event, state) => {
                if (state === 'completed') {
                    downloadInfo.status = 'completed';
                    downloadInfo.received = downloadInfo.total;
                } else {
                    downloadInfo.status = 'failed';
                }
                this.send('update', downloadInfo);
            });
        });

        this.setupHandlers();
    }

    setupHandlers() {
        this.handle('get', () => {
            return Array.from(this.downloads.values());
        });

        this.handle('open', (event, id) => {
            const dl = this.downloads.get(id);
            if (dl && dl.path) {
                shell.showItemInFolder(dl.path);
            }
        });
        
        this.handle('clear', () => {
            this.downloads.clear();
            return { success: true };
        });
    }
}

module.exports = DownloadService;
