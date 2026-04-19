'use strict';

/**
 * LLM Router — unified interface for OpenRouter (cloud) and Ollama (local).
 * Both providers are streamed via async generators consumed by ipcHandlers.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ─── OpenRouter ───────────────────────────────────────────────────────────────

/**
 * Stream chat completions from OpenRouter.
 * @param {string} apiKey
 * @param {string} model  e.g. "meta-llama/llama-3.3-70b-instruct:free"
 * @param {Array}  messages  [{role, content}, ...]
 * @param {function} onChunk  called with each text chunk
 * @param {function} onDone   called when stream ends
 * @param {function} onError  called with error
 */
function streamOpenRouter({ apiKey, model, messages, onChunk, onDone, onError }) {
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
  });

  const options = {
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NexusBrowser/1.0',
      'HTTP-Referer': 'https://nexus-browser.app',
      'X-Title': 'Nexus Browser',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = https.request(options, (res) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      let msg = `AI Provider rejected request with status ${res.statusCode}.`;
      if (res.statusCode === 429) msg = "Rate Limited (429): Too many requests. Please wait a moment or try a different model.";
      else if (res.statusCode === 401) msg = "Authentication Error (401): Invalid or missing API key. Check your settings.";
      else if (res.statusCode === 404) msg = `Model not found (404): The selected model "${model}" is unavailable.`;
      
      console.error(`[NEXUS:MAIN] OpenRouter HTTP Error: ${res.statusCode}`);
      onError(new Error(msg));
      return;
    }
    
    let buffer = '';
    
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) onChunk(delta);
        } catch (_) {
          // Ignore malformed SSE lines
        }
      }
    });

    res.on('end', () => onDone());
    res.on('error', onError);
  });

  req.on('error', onError);
  req.write(body);
  req.end();

  return () => req.destroy(); // Correct: Return abort function
}

/**
 * Fetch available free models from OpenRouter.
 */
async function fetchOpenRouterModels(apiKey) {
  if (!apiKey) throw new Error('API key is required for OpenRouter');
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/models',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'Nexus-Browser/1.0',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode === 401) {
          return reject(new Error('Invalid OpenRouter API key. Please check your settings.'));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`OpenRouter returned status ${res.statusCode}`));
        }
        
        try {
          const json = JSON.parse(body);
          const models = (json.data || [])
            .filter((m) => {
              const cost = parseFloat(m.pricing?.completion || '1');
              return cost === 0 || m.id.includes(':free');
            })
            .map((m) => ({
              id: m.id,
              name: m.name || m.id,
              context: m.context_length || 4096,
              description: m.description || '',
            }));
          resolve(models);
        } catch (e) {
          reject(new Error('Failed to parse model list from OpenRouter.'));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });
    
    // Hard socket timeout
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('OpenRouter connection timed out. Interface aborted request.'));
    });

    req.end();
  });
}

// ─── Ollama ───────────────────────────────────────────────────────────────────

/**
 * Stream chat completions from a local Ollama server.
 */
function streamOllama({ baseUrl, model, messages, onChunk, onDone, onError }) {
  const url = new URL('/api/chat', baseUrl);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;

  const body = JSON.stringify({
    model,
    messages,
    stream: true,
    options: {
        num_ctx: 4096,
        temperature: 0.7
    },
    keep_alive: "5m" // Keep in memory for 5 mins
  });

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = lib.request(options, (res) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      let msg = `Ollama rejected request with status ${res.statusCode}.`;
      if (res.statusCode === 404) msg = `Model not found (404): Ensure you have pulled "${model}" in Ollama (\`ollama pull ${model}\`).`;
      else if (res.statusCode === 503) msg = "Ollama is overloaded or initialising. Please try again in a few seconds.";

      console.error(`[NEXUS:MAIN] Ollama HTTP Error: ${res.statusCode}`);
      onError(new Error(msg));
      return;
    }

    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const json = JSON.parse(trimmed);
          const content = json.message?.content;
          if (content) onChunk(content);
          if (json.done) onDone();
        } catch (_) {}
      }
    });

    res.on('end', () => onDone());
    res.on('error', onError);
  });

  req.on('error', onError);
  req.write(body);
  req.end();

  return () => req.destroy(); // Correct: Return abort function
}

/**
 * Fetch models available in Ollama.
 */
async function fetchOllamaModels(baseUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/tags', baseUrl);
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.get(url.toString(), (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const models = (json.models || []).map((m) => ({
            id: m.name,
            name: m.name,
            size: m.size,
          }));
          resolve(models);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy();
      reject(new Error('Ollama connection timeout'));
    });
  });
}

/**
 * Ping Ollama to check if it's running.
 */
async function pingOllama(baseUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL('/', baseUrl);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(url.toString(), (res) => {
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

// ─── Pollinations AI ──────────────────────────────────────────────────────────

/**
 * Stream chat completions from Pollinations.
 */
function streamPollinations({ apiKey, model, messages, onChunk, onDone, onError }) {
  const body = JSON.stringify({
    model,
    messages,
    stream: true,
  });

  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://nexus-browser.app',
    'X-Title': 'Nexus Browser',
    'Content-Length': Buffer.byteLength(body),
  };
  
  if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const options = {
    hostname: 'text.pollinations.ai',
    path: '/openai/v1/chat/completions',
    method: 'POST',
    headers,
  };

  const req = https.request(options, (res) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
      console.error(`[NEXUS:MAIN] Pollinations HTTP Error: ${res.statusCode}`);
      onError(new Error(`Pollinations AI rejected request with status ${res.statusCode}.`));
      return;
    }
    
    let buffer = '';
    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) onChunk(delta);
        } catch (_) {}
      }
    });

    res.on('end', () => onDone());
    res.on('error', onError);
  });

  req.on('error', onError);
  req.write(body);
  req.end();

  return () => req.destroy();
}

/**
 * Fetch available models from Pollinations.
 */
async function fetchPollinationsModels() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'text.pollinations.ai',
      path: '/models',
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const models = Array.isArray(json) ? json.map(m => ({
              id: m.name || m.id,
              name: m.description || m.name || m.id,
              context_length: m.context_length || 4096
          })) : [];
          
          if(models.length === 0) throw new Error('Empty model list');
          resolve(models);
        } catch (e) {
          // Robust fallback to known working models
          resolve([
              {id: 'openai', name: 'OpenAI (Pollinations Default)'},
              {id: 'mistral', name: 'Mistral'},
              {id: 'claude', name: 'Claude'}
          ]);
        }
      });
    });

    req.on('error', () => {
        // Even on network error, return the fallback for Pollinations (it's often reliable but proxy-sensitive)
        resolve([
            {id: 'openai', name: 'OpenAI (Pollinations Default)'},
            {id: 'mistral', name: 'Mistral'},
            {id: 'claude', name: 'Claude'}
        ]);
    });

    req.setTimeout(5000, () => {
      req.destroy();
      resolve([
          {id: 'openai', name: 'OpenAI (Pollinations Default)'},
          {id: 'mistral', name: 'Mistral'},
          {id: 'claude', name: 'Claude'}
      ]);
    });

    req.end();
  });
}

// ─── Unified Stream ───────────────────────────────────────────────────────────

/**
 * Route a stream request to the correct provider.
 * @param {object} settings — from electron-store
 * @param {Array}  messages
 * @param {function} onChunk
 * @param {function} onDone
 * @param {function} onError
 */
function streamLLM({ settings, messages, model, onChunk, onDone, onError }) {
  const provider = settings.provider || 'openrouter';
  let targetModel = model;
  
  if (!targetModel) {
      if (provider === 'openrouter') targetModel = settings.openrouterModel;
      else if (provider === 'ollama') targetModel = settings.ollamaModel;
      else if (provider === 'pollinations') targetModel = settings.pollinationsModel;
  }

  if (provider === 'openrouter') {
    return streamOpenRouter({
      apiKey: settings.openrouterApiKey,
      model: targetModel || 'meta-llama/llama-3.3-70b-instruct:free',
      messages,
      onChunk,
      onDone,
      onError,
    });
  } else if (provider === 'ollama') {
    return streamOllama({
      baseUrl: settings.ollamaBaseUrl || 'http://localhost:11434',
      model: targetModel || 'llama3.2',
      messages,
      onChunk,
      onDone,
      onError,
    });
  } else if (provider === 'pollinations') {
      return streamPollinations({
        apiKey: settings.pollinationsApiKey,
        model: targetModel || 'openai',
        messages,
        onChunk,
        onDone,
        onError,
      });
  } else {
    onError(new Error(`Unknown provider: ${provider}`));
  }
}

module.exports = {
  streamLLM,
  streamOpenRouter,
  streamOllama,
  streamPollinations,
  fetchOpenRouterModels,
  fetchOllamaModels,
  fetchPollinationsModels,
  pingOllama,
};
