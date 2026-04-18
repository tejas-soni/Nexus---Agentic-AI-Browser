'use strict';

(function() {
    // Session-consistent noise seed
    const seed = parseFloat((Math.random() * 10).toFixed(2));

    const injectNoise = (data) => {
        for (let i = 0; i < data.length; i += 4) {
            // Apply subtle noise to R, G, B channels
            data[i] = data[i] + (seed % 2 === 0 ? 1 : -1);
            data[i+1] = data[i+1] + (seed % 3 === 0 ? 1 : -1);
            data[i+2] = data[i+2] + (seed % 5 === 0 ? 1 : -1);
        }
    };

    // ─── Canvas Fingerprinting Protection ──────────────────────────

    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(type, ...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
            try {
                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                injectNoise(imageData.data);
                ctx.putImageData(imageData, 0, 0);
            } catch (e) {}
        }
        return originalToDataURL.apply(this, [type, ...args]);
    };

    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
        const imageData = originalGetImageData.apply(this, [x, y, w, h]);
        injectNoise(imageData.data);
        return imageData;
    };

    // ─── WebGL Fingerprinting Protection ───────────────────────────

    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
        const result = originalGetParameter.apply(this, [parameter]);
        
        // Spoof common fingerprinting parameters
        if (typeof result === 'string') {
            if (parameter === 37445 || parameter === 37446) { // UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL
                return result + ' (Privacy Enhanced)';
            }
        }
        return result;
    };

    console.log('[NEXUS:SHIELDS] Privacy overrides active.');
})();
