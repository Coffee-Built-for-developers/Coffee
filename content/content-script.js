/**
 * Coffee Extension – Content Script v1.2
 *
 * FIXES:
 * 1. Re-entrant loop fix: uses WeakSet lock so our own re-dispatched
 *    'change' event never triggers a second processing pass.
 *
 * 2. File type detection: previously checked file.type.startsWith('image/')
 *    but browsers often set MIME type to "" for inputs that accept="*" or
 *    accept is unset. Now we ALSO check the file extension as a fallback,
 *    so images selected from any file input are always processed.
 *
 * 3. Double-add on multi-image sites: the re-dispatched 'change' event was
 *    being picked up by the site's own handler a second time, adding files
 *    again. Fixed by only dispatching framework-notification events once the
 *    lock ensures our listener won't re-enter, and by using a stable
 *    Object.defineProperty so the new FileList is observable.
 */

'use strict';

(() => {

  // ── State ──────────────────────────────────────────────────────────────────
  let isEnabled = true;

  chrome.storage.sync.get(['coffeeEnabled'], (r) => {
    isEnabled = r.coffeeEnabled !== false;
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.coffeeEnabled) isEnabled = changes.coffeeEnabled.newValue !== false;
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  const processor = window.__coffeeImageProcessor;

  /** Image extensions we handle (fallback when MIME type is empty/wrong) */
  const IMAGE_EXTS = new Set(['jpg','jpeg','png','webp','gif','bmp','tiff','tif','heic','heif','avif']);

  /**
   * Returns true if this file is an image — by MIME type OR by extension.
   * Browsers sometimes leave file.type = "" for generic file inputs,
   * so extension check is the necessary fallback.
   */
  function isImageFile(file) {
    if (file.type && file.type.startsWith('image/')) return true;
    const ext = file.name.split('.').pop().toLowerCase();
    return IMAGE_EXTS.has(ext);
  }

  function buildFileList(files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    return dt.files;
  }

  function saveImageHistory(entries) {
    chrome.storage.local.get(['coffeeHistory'], (r) => {
      const prev = r.coffeeHistory || [];
      chrome.storage.local.set({ coffeeHistory: [...entries, ...prev].slice(0, 50) });
    });
  }

  function incrementCleanCount(n) {
    chrome.storage.sync.get(['coffeeCleanCount'], (r) => {
      chrome.storage.sync.set({ coffeeCleanCount: (r.coffeeCleanCount || 0) + n });
    });
  }

  /**
   * Core pipeline: take a FileList, clean all image files, return clean array
   * + history entries. Non-image files pass through untouched.
   */
  async function processFiles(fileList) {
    const files = Array.from(fileList);
    const imageFiles  = files.filter(isImageFile);
    const otherFiles  = files.filter(f => !isImageFile(f));

    if (imageFiles.length === 0) return { cleanFiles: files, historyEntries: [] };

    const results     = await processor.removeMetadataFromList(imageFiles);
    const cleanImages = results.map(r => r.file);
    const historyEntries = results.map(r => ({
      name:          r.name,
      originalSize:  r.originalSize,
      cleanSize:     r.cleanSize,
      removedFields: r.removedFields,
      timestamp:     Date.now(),
      site:          location.hostname,
    }));

    incrementCleanCount(imageFiles.length);
    saveImageHistory(historyEntries);

    // Re-interleave preserving original order
    let imgIdx = 0, othIdx = 0;
    const cleanFiles = files.map(f => isImageFile(f) ? cleanImages[imgIdx++] : otherFiles[othIdx++]);
    return { cleanFiles, historyEntries };
  }

  // ── A. <input type="file"> interception ───────────────────────────────────

  const attachedInputs  = new WeakSet(); // inputs we've hooked
  const processingInputs = new WeakSet(); // inputs currently being processed (lock)

  function attachInputListener(input) {
    if (attachedInputs.has(input)) return;
    attachedInputs.add(input);

    input.addEventListener('change', async () => {
      if (!isEnabled) return;
      if (!input.files || input.files.length === 0) return;

      // ── Re-entrancy guard ────────────────────────────────────────────────
      // If we are in the middle of processing this input, this 'change' event
      // was fired by OUR OWN dispatchEvent below — skip it entirely.
      if (processingInputs.has(input)) return;

      const hasImages = Array.from(input.files).some(isImageFile);
      if (!hasImages) return;

      // Acquire lock + disable to stop the site from submitting mid-process
      processingInputs.add(input);
      input.disabled = true;

      try {
        const { cleanFiles } = await processFiles(input.files);

        // Replace the FileList (read-only natively, so use defineProperty)
        Object.defineProperty(input, 'files', {
          value:        buildFileList(cleanFiles),
          writable:     true,
          configurable: true,
        });

        // Notify React / Vue / Angular etc. that files changed.
        // Our listener is still locked, so these events won't recurse.
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input',  { bubbles: true }));

      } catch (err) {
        console.error('[Coffee] Input processing error:', err);
      } finally {
        // Release lock in a microtask — AFTER the synchronous re-dispatch
        // above has fully propagated through all handlers on the call stack.
        Promise.resolve().then(() => {
          processingInputs.delete(input);
          input.disabled = false;
        });
      }

    }, true); // capture phase: we run before the page's handlers
  }

  function initInputListeners() {
    document.querySelectorAll('input[type="file"]').forEach(attachInputListener);

    // Watch for dynamically inserted inputs (SPAs, modals, etc.)
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.matches?.('input[type="file"]')) attachInputListener(node);
          node.querySelectorAll?.('input[type="file"]').forEach(attachInputListener);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // ── B. Drag-and-drop interception ─────────────────────────────────────────

  function initDragDropListeners() {
    // dragover: do nothing, but must be present so drop targets stay active
    document.addEventListener('dragover', () => {}, true);

    document.addEventListener('drop', async (e) => {
      if (!isEnabled) return;
      if (e.__coffeeProcessed) return; // skip events we re-fired ourselves

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const hasImages = Array.from(files).some(isImageFile);
      if (!hasImages) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      try {
        const { cleanFiles } = await processFiles(files);

        const dt = new DataTransfer();
        cleanFiles.forEach(f => dt.items.add(f));

        const clean = new DragEvent('drop', {
          bubbles: true, cancelable: true,
          dataTransfer: dt,
          clientX: e.clientX, clientY: e.clientY,
        });
        Object.defineProperty(clean, '__coffeeProcessed', { value: true });
        e.target.dispatchEvent(clean);

      } catch (err) {
        console.error('[Coffee] Drag-drop error:', err);
        // On failure let the original drop through so upload isn't lost
        const pass = new DragEvent('drop', {
          bubbles: true, cancelable: true, dataTransfer: e.dataTransfer,
        });
        Object.defineProperty(pass, '__coffeeProcessed', { value: true });
        e.target.dispatchEvent(pass);
      }
    }, true);
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init() {
    initInputListeners();
    initDragDropListeners();
    console.info('[Coffee] ☕ v1.2 active — intercepts all image file inputs & drag-drop.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
