'use strict';

/**
 * Agent Runner — ReAct-pattern (Reason + Act) loop for AI agents.
 * Phase 2 Enhanced: Added Autonomous Browser Interaction Tools.
 */

const https = require('https');
const { streamLLM } = require('./llmRouter');

/**
 * Define tool metadata and execution logic.
 * In Phase 2, some tools require 'browserActions' to be provided.
 */
function getTools(browserActions) {
  return {
    web_search: {
      name: 'web_search',
      description: 'Search the web for information. Input: a search query string.',
      execute: async (input) => {
        return new Promise((resolve) => {
          const query = encodeURIComponent(input.trim());
          const url = `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1&skip_disambig=1`;

          https.get(url, { headers: { 'User-Agent': 'Nexus-Browser/1.0' } }, (res) => {
            let body = '';
            res.on('data', (d) => (body += d));
            res.on('end', () => {
              try {
                const json = JSON.parse(body);
                const results = [];
                if (json.AbstractText) results.push(`Summary: ${json.AbstractText}`);
                (json.RelatedTopics || []).slice(0, 5).forEach((t) => {
                  if (t.Text) results.push(`• ${t.Text}`);
                });
                resolve(results.length > 0 ? results.join('\n') : 'No results found.');
              } catch {
                resolve('Search failed — could not parse results.');
              }
            });
          }).on('error', () => resolve('Search failed — network error.'));
        });
      },
    },

    browse_active_tab: {
      name: 'browse_active_tab',
      description: 'See what is on the currently active web page. Returns the page title, URL, summary, and a list of interactive element IDs.',
      execute: async () => {
        if (!browserActions?.getSnapshot) return 'Browser control not available.';
        const result = await browserActions.getSnapshot();
        if (!result.success) return `Failed to read page: ${result.error}`;
        
        const { title, url, summary, elements, image } = result.snapshot;
        let output = `Currently on: ${title} (${url})\n\nPage Summary: ${summary}\n\nInteractive Elements:\n`;
        elements.forEach(el => {
          output += `- [${el.id}] ${el.tag}${el.role ? ` (role: ${el.role})` : ''}: "${el.text}"\n`;
        });
        
        const isVisionModel = (model || '').toLowerCase().match(/vision|vlm|claude-3|gemini-1\.5|gpt-4o|pixtral|llava/);
        if (image && isVisionModel) {
          return { type: 'multimodal', text: output, image_url: image };
        }
        return output;
      }
    },

    click_element: {
      name: 'click_element',
      description: 'Click an interactive element on the page. Input: the element ID (e.g., "nx-5").',
      execute: async (id) => {
        if (!browserActions?.interact) return 'Browser control not available.';
        const result = await browserActions.interact('click', { id });
        return result.success ? `Successfully clicked ${id}.` : `Failed to click ${id}: ${result.error || 'element not found'}`;
      }
    },

    type_text: {
      name: 'type_text',
      description: 'Type text into an input field. Input: JSON string like {"id": "nx-1", "text": "hello"}.',
      execute: async (input) => {
        if (!browserActions?.interact) return 'Browser control not available.';
        try {
          const { id, text } = typeof input === 'string' ? JSON.parse(input) : input;
          const result = await browserActions.interact('type', { id, text });
          return result.success ? `Successfully typed into ${id}.` : `Failed to type: ${result.error || 'element not found'}`;
        } catch {
          return 'Invalid input format. Use {"id": "...", "text": "..."}';
        }
      }
    },

    scroll: {
      name: 'scroll',
      description: 'Scroll the active page. Input: "up" or "down".',
      execute: async (direction) => {
        if (!browserActions?.interact) return 'Browser control not available.';
        await browserActions.interact('scroll', { direction });
        return `Scrolled ${direction}.`;
      }
    },

    navigate_to: {
      name: 'navigate_to',
      description: 'Go to a specific URL in the active tab. Input: the full URL.',
      execute: async (url) => {
        if (!browserActions?.navigate) return 'Navigation not available.';
        await browserActions.navigate(url);
        return `Navigating to ${url}...`;
      }
    },
    
    close_tabs: {
      name: 'close_tabs',
      description: 'Close tabs in a specific direction. Input: "left", "right", or "other".',
      execute: async (direction) => {
        if (!browserActions?.closeTabs) return 'Tab control not available.';
        await browserActions.closeTabs(direction);
        return `Request sent to close tabs: ${direction}.`;
      }
    },
    
    bookmark_current: {
      name: 'bookmark_current',
      description: 'Add the current page to bookmarks.',
      execute: async () => {
        if (!browserActions?.bookmark) return 'Bookmark action not available.';
        await browserActions.bookmark();
        return 'Bookmark request sent.';
      }
    },
    
    set_theme: {
      name: 'set_theme',
      description: 'Change the browser theme. Input: "dark" or "light".',
      execute: async (mode) => {
        if (!browserActions?.setTheme) return 'Theme control not available.';
        await browserActions.setTheme(mode);
        return `Theme changed to ${mode}.`;
      }
    },

    take_note: {
      name: 'take_note',
      description: 'Save important information to your notebook. Input: the content to save.',
      execute: async (input) => `Note saved: "${input}"`,
    },

    generate_image: {
      name: 'generate_image',
      description: 'Generate an AI image. Input: description/prompt.',
      execute: async (input) => {
        const encoded = encodeURIComponent(input.trim());
        return `Image generated: https://image.pollinations.ai/prompt/${encoded}?width=512&height=512&nologo=true`;
      },
    },

    report: {
      name: 'report',
      description: 'Give the final answer to the user. Input: complete final answer text.',
      execute: async (input) => input,
    },
  };
}

// ─── System Prompt Builder ────────────────────────────────────────────────────

function buildAgentSystemPrompt(agentName, agentDescription, toolMetadata) {
  const toolDescriptions = Object.values(toolMetadata)
    .map((t) => `  - ${t.name}: ${t.description}`)
    .join('\n');

  return `You are "${agentName}", a high-precision autonomous browser controller.
${agentDescription ? `Role: ${agentDescription}` : ''}

GOAL: Complete the user's task by taking full control of the web browser.

OPERATIONAL RULES:
1. ACTION FIRST: If a task involves a website (booking, shopping, searching), navigate to it immediately. Do not ask for permission.
2. JSON ONLY: You MUST communicate with the system using ONLY a single JSON object. No conversational text outside the JSON.
3. LOOPING: Use 'browse_active_tab' to see the page, then use 'click_element' or 'type_text' using the element IDs (e.g., nx-5).
4. COMPLETION: Once your task is finished, use the 'report' tool.

REQUIRED RESPONSE FORMAT (JSON):
{
  "thought": "Direct technical reasoning for this specific step",
  "tool": "tool_name",
  "input": "tool input string"
}

AVAILABLE TOOLS:
${toolDescriptions}

PROTOCOL: Thought → Action → Observation. Proceed until task complete or MAX_STEPS reached.`;
}

// ─── ReAct Loop ──────────────────────────────────────────────────────────────

/**
 * Robustly extract and parse JSON from talkative LLM responses.
 */
function extractAndParseJSON(text) {
  try {
    // 1. Try to find JSON inside Markdown blocks
    const mdMatch = text.match(/```json\s*(\{[\s\S]*?\})\s*```/) || text.match(/```\s*(\{[\s\S]*?\})\s*```/);
    if (mdMatch) return JSON.parse(mdMatch[1]);

    // 2. Fallback: find the first { and last }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      return JSON.parse(text.substring(start, end + 1));
    }
    
    // 3. Last resort: direct parse
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function runAgent({ agentId, agentName, agentDescription, task, model, settings, onStep, onDone, onError, browserActions }) {
  let aborted = false;
  let currentRequest = null;
  let stepCount = 0;
  const MAX_STEPS = 30; // Doubled for complex real-world workflows

  const TOOLS = getTools(browserActions);

  const messages = [
    { role: 'system', content: buildAgentSystemPrompt(agentName, agentDescription, TOOLS) + `\n\nDEADLINE: You have a maximum of ${MAX_STEPS} steps to complete this mission. If you reach step 25, you MUST prioritize the 'report' tool with whatever info you have.` },
    { role: 'user', content: `CRITICAL MISSION: ${task}` },
  ];

  const executeNextStep = () => {
    if (aborted) return;
    if (stepCount >= MAX_STEPS) {
      onStep({ type: 'error', content: 'Agent reached maximum steps limit (30).' });
      onDone();
      return;
    }

    stepCount++;
    let responseText = '';
    onStep({ type: 'thinking', content: `Step ${stepCount}/${MAX_STEPS}: Analyzing and deciding...` });

    currentRequest = streamLLM({
      settings,
      messages,
      model,
      onChunk: (chunk) => {
        if (aborted) return;
        responseText += chunk;
        // Suppress raw stream events so UI doesn't get flooded with JSON brackets
      },
      onDone: async () => {
        if (aborted) return;

        const parsed = extractAndParseJSON(responseText);
        
        if (!parsed) {
          onStep({ type: 'error', content: 'The agent provided a conversational response. Retrying...' });
          messages.push({ role: 'assistant', content: responseText }, { role: 'user', content: 'Observation: Invalid Format. Use JSON only.' });
          executeNextStep();
          return;
        }

        const { thought, tool: toolName, input } = parsed;
        onStep({ type: 'thought', content: thought });

        let readableInput = typeof input === 'string' ? input : JSON.stringify(input);
        try {
            if (typeof input === 'object' && toolName === 'type_text') {
                readableInput = `typing "${input.text}" into element [${input.id}]`;
            } else if (typeof input === 'string' && input.trim().startsWith('{')) {
                const p = JSON.parse(input);
                if (toolName === 'type_text') {
                    readableInput = `typing "${p.text}" into element [${p.id}]`;
                } else {
                    readableInput = JSON.stringify(p, null, 2);
                }
            }
        } catch (_) {}
        
        onStep({ type: 'tool_call', content: `Using: ${toolName}(${readableInput})` });

        const tool = TOOLS[toolName];
        if (!tool) {
          const obs = `Tool "${toolName}" not found.`;
          messages.push({ role: 'assistant', content: responseText }, { role: 'user', content: `Observation: ${obs} (Step ${stepCount}/${MAX_STEPS})` });
          onStep({ type: 'observation', content: obs });
          executeNextStep();
          return;
        }

        try {
          const observation = await tool.execute(input);
          
          let obsContent;
          if (observation && observation.type === 'multimodal') {
             obsContent = [
                 { type: 'text', text: `Observation: ${observation.text}\n(Project Progress: Step ${stepCount} of ${MAX_STEPS})` },
                 { type: 'image_url', image_url: { url: observation.image_url } }
             ];
             onStep({ type: 'observation', content: observation.text + "\n\n[👁️ Visual Screenshot Included for Evaluation]" });
          } else {
             obsContent = `Observation: ${observation}\n(Project Progress: Step ${stepCount} of ${MAX_STEPS})`;
             onStep({ type: 'observation', content: observation });
          }

          if (toolName === 'report') {
            onStep({ type: 'result', content: observation });
            // Drop out of the automatic step loop to pause execution
            currentRequest = null;
            return;
          }

          if (toolName === 'take_note') onStep({ type: 'note', content: input });
          if (toolName === 'generate_image') {
            const strObs = typeof observation === 'string' ? observation : observation.text;
            const urlMatch = (strObs || '').match(/https?:\/\/\S+/);
            if (urlMatch) onStep({ type: 'image', content: urlMatch[0] });
          }

          messages.push({ role: 'assistant', content: responseText }, { role: 'user', content: obsContent });
          executeNextStep();
        } catch (err) {
          onStep({ type: 'error', content: `Tool error: ${err.message}` });
          messages.push({ role: 'assistant', content: responseText }, { role: 'user', content: `Observation: Error: ${err.message} (Step ${stepCount}/${MAX_STEPS})` });
          executeNextStep();
        }
      },
      onError: (err) => { if (!aborted) onError(err); },
    });
  };

  // Start the loop with a small delay to avoid "burst" behavior that triggers anti-bot filters
  const ignitionDelay = settings.timeout || 300;
  setTimeout(() => {
    if (!aborted) executeNextStep();
  }, ignitionDelay);

  return {
    abort: () => {
      aborted = true;
      if (typeof currentRequest === 'function') currentRequest();
      else if (currentRequest?.destroy) currentRequest.destroy();
      onStep({ type: 'abort', content: 'Agent was stopped.' });
    },
    sendInstruction: (text) => {
      // Abort active stream request to intercept gracefully
      if (typeof currentRequest === 'function') currentRequest();
      else if (currentRequest?.destroy) currentRequest.destroy();
      currentRequest = null;
      
      onStep({ type: 'info', content: `[User Interaction]: ${text}` });
      messages.push({ role: 'user', content: `CRITICAL INSTRUCTION FROM USER: ${text}` });
      
      // Immediately loop the agent with the new context
      executeNextStep();
    }
  };
}

module.exports = { runAgent };
