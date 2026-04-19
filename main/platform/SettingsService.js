'use strict';

const Service = require('./Service');
const { getSettings, saveSettings, getPreferences, savePreferences } = require('../storage');
const llmRouter = require('../llmRouter');

class SettingsService extends Service {
    async init() {
        this.log('Initializing Settings...');
        this.setupHandlers();
        
        // Proactively hydrate the current provider's model cache on startup.
        setTimeout(() => {
            this.log('Startup: Attempting proactive background model fetch...');
            const settings = { ...getSettings(), ...getPreferences() };

            this.refreshProviderModels(settings)
                .then((models) => {
                    if (!models.length) {
                        return;
                    }

                    this.log(`Startup: Successfully cached ${models.length} models.`);
                    this.send('updated', {
                        ...settings,
                        modelCacheReady: true,
                        provider: settings.provider || 'openrouter',
                    });
                })
                .catch((e) => this.log(`Startup: Background fetch skipped: ${e.message}`));
        }, 3000); // 3-second delay to allow OS network stack to settle
    }

    async refreshProviderModels(settings) {
        const { cacheModels } = require('../storage');
        const provider = settings.provider || 'openrouter';
        let models = [];

        if (provider === 'openrouter') {
            if (!settings.openrouterApiKey) {
                throw new Error('OpenRouter API key is missing.');
            }
            models = await llmRouter.fetchOpenRouterModels(settings.openrouterApiKey);
        } else if (provider === 'ollama') {
            models = await llmRouter.fetchOllamaModels(settings.ollamaBaseUrl || 'http://localhost:11434');
        } else if (provider === 'pollinations') {
            models = await llmRouter.fetchPollinationsModels();
        } else if (provider === 'groq') {
            if (!settings.groqApiKey) throw new Error('Groq API key is missing.');
            models = await llmRouter.fetchGroqModels(settings.groqApiKey);
        }

        if (models.length > 0) {
            cacheModels(provider, models);
        }

        return models;
    }

    setupHandlers() {
        this.handle('get', () => {
            return { ...getSettings(), ...getPreferences() };
        });

        this.handle('save', (event, settings) => {
            try {
                this.log('Saving all settings and preferences...');
                saveSettings(settings);
                savePreferences(settings);
                this.log('Storage successfully updated.');
                
                // Broadcast to update the rest of the app (e.g., model lists)
                this.send('updated', settings);
                return { success: true };
            } catch (error) {
                this.log(`Error saving settings: ${error.message}`);
                return { success: false, error: error.message };
            }
        });

        this.handle('fetch-models', async () => {
            this.log('Fetching available models for UI refresh...');
            const { getCachedModels, cacheModels } = require('../storage');
            
            try {
                const settings = { ...getSettings(), ...getPreferences() };
                const provider = settings.provider || 'openrouter';
                const models = await this.refreshProviderModels(settings);
                
                if (models.length > 0) {
                    cacheModels(provider, models);
                }
                
                this.log(`Fetched ${models.length} models for provider: ${provider}`);
                return { success: true, models };
            } catch (error) {
                this.log(`Fetch models failed dynamically: ${error.message}`);
                const provider = (getSettings().provider || 'openrouter');
                const cached = getCachedModels(provider);
                if (cached && cached.length > 0) {
                    this.log(`Fallback to offline cached model list successful for provider: ${provider}.`);
                    return { success: true, models: cached, offline: true };
                }
                return { success: false, error: error.message };
            }
        });

        this.handle('test-connection', async () => {
            this.log('Handshake: Starting connection test sequence...');
            try {
                // Ensure we use the latest settings from disk
                const settings = { ...getSettings(), ...getPreferences() };
                const provider = settings.provider || 'openrouter';
                this.log(`Testing connectivity for provider: ${provider}`);
                
                let result;
                if (provider === 'openrouter') {
                    if (!settings.openrouterApiKey) throw new Error('Please enter an API key first.');
                    const models = await this.refreshProviderModels(settings);
                    result = { success: true, message: `Cloud connection verified. Found ${models.length} models.` };
                } else if (provider === 'ollama') {
                    const ok = await llmRouter.pingOllama(settings.ollamaBaseUrl || 'http://localhost:11434');
                    if (ok) {
                        const models = await this.refreshProviderModels(settings);
                        result = { success: true, message: `Local connection verified. ${models.length} models available.` };
                    } else {
                        throw new Error(`Could not reach Ollama at ${settings.ollamaBaseUrl}. Ensure the server is running.`);
                    }
                } else if (provider === 'pollinations') {
                    const models = await this.refreshProviderModels(settings);
                    result = { success: true, message: `Pollinations API is reachable. ${models.length} models found.` };
                } else if (provider === 'groq') {
                    if (!settings.groqApiKey) throw new Error('Please enter a Groq API key first.');
                    const models = await this.refreshProviderModels(settings);
                    result = { success: true, message: `Groq connection verified. ${models.length} ultra-fast models found.` };
                }

                this.send('updated', {
                    ...settings,
                    modelCacheReady: true,
                    provider,
                });
                
                this.log(`Test result: ${result.message}`);
                return result;
            } catch (error) {
                this.log(`Test FAILED: ${error.message}`);
                return { success: false, error: error.message };
            }
        });
    }
}

module.exports = SettingsService;
