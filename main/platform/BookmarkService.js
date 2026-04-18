'use strict';

const Service = require('./Service');
const { getBookmarks, addBookmark, removeBookmark } = require('../storage');
const { dialog } = require('electron');
const fs = require('fs');

class BookmarkService extends Service {
    async init() {
        this.log('Initializing Bookmarks...');
        this.setupHandlers();
    }

    setupHandlers() {
        this.handle('get', () => {
            return getBookmarks();
        });

        this.handle('add', (event, { title, url, favicon }) => {
            addBookmark({ title, url, favicon });
            return { success: true };
        });

        this.handle('remove', (event, id) => {
            removeBookmark(id);
            return { success: true };
        });

        this.handle('export', async (event) => {
            const result = await dialog.showSaveDialog({
                title: 'Export Bookmarks',
                defaultPath: 'nexus_bookmarks.json',
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (!result.canceled && result.filePath) {
                const bms = getBookmarks();
                fs.writeFileSync(result.filePath, JSON.stringify(bms, null, 2));
                return { success: true, path: result.filePath };
            }
            return { success: false };
        });

        this.handle('import', async (event) => {
            const result = await dialog.showOpenDialog({
                title: 'Import Bookmarks',
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (!result.canceled && result.filePaths.length > 0) {
                try {
                    const data = fs.readFileSync(result.filePaths[0], 'utf-8');
                    const imported = JSON.parse(data);
                    if (Array.isArray(imported)) {
                        imported.forEach(bm => addBookmark(bm));
                        return { success: true, count: imported.length };
                    }
                } catch (e) {
                    return { success: false, error: e.message };
                }
            }
            return { success: false };
        });
    }
}

module.exports = BookmarkService;
