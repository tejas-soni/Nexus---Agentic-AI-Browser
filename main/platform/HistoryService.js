'use strict';

const Service = require('./Service');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

class HistoryService extends Service {
    constructor(hub, id) {
        super(hub, id);
        const dbPath = path.join(app.getPath('userData'), 'nexus_history.db');
        this.db = new sqlite3.Database(dbPath);
    }

    async init() {
        this.log('Initializing SQLite database...');
        
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.run(`
                    CREATE TABLE IF NOT EXISTS history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT,
                        url TEXT,
                        favicon TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                    )
                `, (err) => {
                    if (err) reject(err);
                    else {
                        this.log('Database ready.');
                        this.setupHandlers();
                        resolve();
                    }
                });
            });
        });
    }

    setupHandlers() {
        this.handle('get', async (event, { limit = 100, search = '' } = {}) => {
            return new Promise((resolve, reject) => {
                let query = 'SELECT * FROM history';
                let params = [];
                
                if (search) {
                    query += ' WHERE title LIKE ? OR url LIKE ?';
                    params.push(`%${search}%`, `%${search}%`);
                }
                
                query += ' ORDER BY timestamp DESC LIMIT ?';
                params.push(limit);

                this.db.all(query, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                });
            });
        });

        this.handle('add', async (event, { title, url, favicon }) => {
            if (!url || url.startsWith('nexus://') || url.startsWith('about:')) return;
            
            return new Promise((resolve, reject) => {
                const stmt = this.db.prepare('INSERT INTO history (title, url, favicon) VALUES (?, ?, ?)');
                stmt.run(title, url, favicon, function(err) {
                    if (err) reject(err);
                    else resolve({ id: this.lastID });
                });
                stmt.finalize();
            });
        });

        this.handle('clear', async () => {
            return new Promise((resolve, reject) => {
                this.db.run('DELETE FROM history', (err) => {
                    if (err) reject(err);
                    else resolve({ success: true });
                });
            });
        });
        
        this.handle('remove', async (event, id) => {
            return new Promise((resolve, reject) => {
                this.db.run('DELETE FROM history WHERE id = ?', [id], (err) => {
                    if (err) reject(err);
                    else resolve({ success: true });
                });
            });
        });
    }
}

module.exports = HistoryService;
