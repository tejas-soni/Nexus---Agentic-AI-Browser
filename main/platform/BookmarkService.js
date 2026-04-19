'use strict';

const Service = require('./Service');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app, dialog } = require('electron');
const fs = require('fs');
const { getBookmarks: getOldBookmarks } = require('../storage');

class BookmarkService extends Service {
    constructor(hub, id) {
        super(hub, id);
        const dbPath = path.join(app.getPath('userData'), 'nexus_bookmarks.db');
        this.db = new sqlite3.Database(dbPath);
    }

    async init() {
        this.log('Initializing Bookmarks database...');
        
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS bookmarks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT,
                        url TEXT UNIQUE,
                        favicon TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        this.setupHandlers();
                        this.migrateOldBookmarks().then(resolve).catch(resolve);
                    }
                });
            });
        });
    }

    async migrateOldBookmarks() {
        try {
            const oldBms = getOldBookmarks();
            if (oldBms && oldBms.length > 0) {
                this.log(`Migrating ${oldBms.length} legacy bookmarks...`);
                for (const bm of oldBms) {
                    await this.addInDb(bm);
                }
                // We don't delete old bookmarks from storage.js yet to be safe, 
                // but they won't be used anymore.
            }
        } catch (e) {
            this.log(`Migration skipped or failed: ${e.message}`);
        }
    }

    addInDb({ title, url, favicon }) {
        return new Promise((resolve, reject) => {
            const stmt = this.db.prepare('INSERT OR REPLACE INTO bookmarks (title, url, favicon) VALUES (?, ?, ?)');
            stmt.run(title, url, favicon, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            });
            stmt.finalize();
        });
    }

    setupHandlers() {
        this.handle('get', async (event, options) => {
            const { limit = 500, search = '' } = options || {};
            this.log(`Received fetch request (search: "${search}", limit: ${limit})`);
            
            return new Promise((resolve, reject) => {
                let query = 'SELECT * FROM bookmarks';
                let params = [];
                
                if (search) {
                    query += ' WHERE title LIKE ? OR url LIKE ?';
                    params.push(`%${search}%`, `%${search}%`);
                }
                
                query += ' ORDER BY timestamp DESC LIMIT ?';
                params.push(limit);

                this.db.all(query, params, (err, rows) => {
                    if (err) {
                        console.error('[NEXUS:BOOKMARKS] DB Fetch Error:', err);
                        reject(err);
                    } else {
                        this.log(`Found ${rows.length} bookmarks`);
                        resolve(rows);
                    }
                });
            });
        });

        this.handle('add', async (event, { title, url, favicon }) => {
            this.log(`Adding bookmark: ${title} (${url})`);
            try {
                const res = await this.addInDb({ title, url, favicon });
                return { success: true, ...res };
            } catch (err) {
                console.error('[NEXUS:BOOKMARKS] DB Add Error:', err);
                return { success: false, error: err.message };
            }
        });

        this.handle('remove', async (event, id) => {
            this.log(`Removing bookmark ID: ${id}`);
            return new Promise((resolve, reject) => {
                this.db.run('DELETE FROM bookmarks WHERE id = ?', [id], (err) => {
                    if (err) {
                        console.error('[NEXUS:BOOKMARKS] DB Remove Error:', err);
                        reject(err);
                    } else {
                        resolve({ success: true });
                    }
                });
            });
        });

        this.handle('export', async (event) => {
            const result = await dialog.showSaveDialog({
                title: 'Export Bookmarks',
                defaultPath: 'nexus_bookmarks.json',
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });

            if (!result.canceled && result.filePath) {
                const bms = await new Promise((resolve) => {
                    this.db.all('SELECT * FROM bookmarks ORDER BY timestamp DESC', (err, rows) => resolve(rows || []));
                });
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
                        let count = 0;
                        for (const bm of imported) {
                            try {
                                await this.addInDb(bm);
                                count++;
                            } catch (e) { /* skip duplicates */ }
                        }
                        return { success: true, count };
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
