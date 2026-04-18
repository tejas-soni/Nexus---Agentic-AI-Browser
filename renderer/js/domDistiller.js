'use strict';

/**
 * Nexus DOM Distiller
 * This script runs inside the webview to extract interactive elements and 
 * content in a way that minimizes token usage for the LLM.
 */

(function() {
  function getDistilledDOM() {
    const interactiveElements = [];
    const selector = 'button, a, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"]';
    
    // Clear old visual tags
    document.querySelectorAll('.nexus-ai-tag').forEach(tag => tag.remove());
    
    // Assign unique IDs and collect data
    const elements = document.querySelectorAll(selector);
    elements.forEach((el, index) => {
      // Skip hidden/invisible elements
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(el).display === 'none') {
        return;
      }

      const id = `nx-${index}`;
      el.setAttribute('data-nexus-id', id);

      // Render Visual Bounding Tag for VLM
      const tagEl = document.createElement('div');
      tagEl.className = 'nexus-ai-tag';
      tagEl.innerText = id;
      tagEl.style.cssText = `
        position: absolute;
        top: ${Math.max(0, rect.top + window.scrollY)}px;
        left: ${Math.max(0, rect.left + window.scrollX)}px;
        background-color: #ffeb3b; /* high visibility */
        color: #000;
        font-size: 11px;
        font-family: monospace;
        font-weight: bold;
        padding: 2px 4px;
        border: 1px solid #000;
        border-radius: 3px;
        z-index: 2147483647;
        pointer-events: none;
        box-shadow: 0 2px 4px rgba(0,0,0,0.5);
      `;
      document.body.appendChild(tagEl);

      interactiveElements.push({
        id: id,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        role: el.getAttribute('role') || null,
        text: (el.innerText || el.value || el.placeholder || el.ariaLabel || '').trim().substring(0, 100),
        href: el.tagName === 'A' ? el.href : null,
        checked: el.checked
      });
    });

    // Extract main text content (briefly)
    const title = document.title;
    const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
    
    // Simple text summary: get headings and initial paragraphs
    const mainParagraphs = Array.from(document.querySelectorAll('h1, h2, h3, p'))
      .slice(0, 10)
      .map(el => el.innerText.trim())
      .filter(t => t.length > 50)
      .join('\n\n')
      .substring(0, 1000);

    return {
      title,
      description: metaDescription,
      url: window.location.href,
      elements: interactiveElements,
      summary: mainParagraphs
    };
  }

  // Handle specific interaction commands
  window.nexusInteract = {
    click: function(id) {
      const el = document.querySelector(`[data-nexus-id="${id}"]`);
      if (el) {
        el.click();
        return true;
      }
      return false;
    },
    type: function(id, text) {
      const el = document.querySelector(`[data-nexus-id="${id}"]`);
      if (el) {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    },
    scroll: function(direction) {
      if (direction === 'down') window.scrollBy(0, window.innerHeight * 0.8);
      else if (direction === 'up') window.scrollBy(0, -window.innerHeight * 0.8);
      return true;
    }
  };

  return getDistilledDOM();
})();
