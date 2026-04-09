/**
 * Coffee Extension – Background Service Worker
 * ==============================================
 * Handles extension lifecycle events and cross-context messaging.
 * In Manifest V3, background scripts are service workers — they are
 * ephemeral (spun up on demand, terminated when idle) so we avoid
 * storing state in variables. Everything lives in chrome.storage.
 */

'use strict';

// ─── Installation & defaults ─────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    // Set sensible defaults on first install.
    chrome.storage.sync.set({
      coffeeEnabled:    true,
      coffeeCleanCount: 0,
    });
    console.info('[Coffee] Extension installed. Defaults set.');
  }
  if (reason === 'update') {
    console.info('[Coffee] Extension updated.');
  }
});

// ─── Message handling ────────────────────────────────────────────────────────

/**
 * Messages from popup or content scripts.
 *
 * Supported actions:
 *   { action: 'getStatus' }   → returns { enabled, cleanCount }
 *   { action: 'setEnabled', value: bool } → toggles protection
 *   { action: 'resetCount' }  → resets clean counter to 0
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.action) {

    case 'getStatus':
      chrome.storage.sync.get(['coffeeEnabled', 'coffeeCleanCount'], (data) => {
        sendResponse({
          enabled:    data.coffeeEnabled !== false,
          cleanCount: data.coffeeCleanCount || 0,
        });
      });
      return true; // keep channel open for async sendResponse

    case 'setEnabled':
      chrome.storage.sync.set({ coffeeEnabled: !!message.value }, () => {
        sendResponse({ ok: true });
      });
      return true;

    case 'resetCount':
      chrome.storage.sync.set({ coffeeCleanCount: 0 }, () => {
        sendResponse({ ok: true });
      });
      return true;

    default:
      sendResponse({ error: 'Unknown action' });
  }
});
