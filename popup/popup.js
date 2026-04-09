/**
 * Coffee Extension – Popup Script
 * Handles main screen, toggle, counter, and history panel.
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const toggleInput    = document.getElementById('toggleInput');
const statusPill     = document.getElementById('statusPill');
const statusDot      = document.getElementById('statusDot');
const statusText     = document.getElementById('statusText');
const heroParagraph  = document.getElementById('heroParagraph');
const cleanCount     = document.getElementById('cleanCount');
const resetBtn       = document.getElementById('resetBtn');
const historyBtn     = document.getElementById('historyBtn');
const backBtn        = document.getElementById('backBtn');
const clearHistoryBtn= document.getElementById('clearHistoryBtn');
const screensWrapper = document.getElementById('screensWrapper');
const historyList    = document.getElementById('historyList');
const emptyState     = document.getElementById('emptyState');
const app            = document.getElementById('app');

// ── Render: toggle state ──────────────────────────────────────────────────────
function renderEnabled(enabled) {
  toggleInput.checked = enabled;
  if (enabled) {
    statusPill.classList.remove('off');
    statusText.textContent = 'Protecting';
    heroParagraph.textContent = 'All image uploads are being cleaned';
    app.classList.remove('disabled');
  } else {
    statusPill.classList.add('off');
    statusText.textContent = 'Paused';
    heroParagraph.textContent = 'Images will upload with original metadata';
    app.classList.add('disabled');
  }
}

// ── Render: count ─────────────────────────────────────────────────────────────
function renderCount(n) {
  cleanCount.textContent = n.toLocaleString();
}

function bumpCount() {
  cleanCount.classList.remove('bump');
  void cleanCount.offsetWidth;
  cleanCount.classList.add('bump');
}

// ── History: chip color by tag ────────────────────────────────────────────────
const TAG_CLASS = {
  GPS: 'gps', EXIF: 'exif', EXIFIFD: 'exif', DATE: 'date', DATEMOD: 'date',
  MAKE: 'device', MODEL: 'device', MAKER: 'device', IMGUID: 'device', ORIENT: 'device',
  THUMB: 'thumb', ARTIST: 'other', WP: 'other', COMMENT: 'other',
  TEXT: 'text', JFIF: 'other', ICC: 'other', XMP: 'other', IPTC: 'other',
  GAMMA: 'other', sRGB: 'other',
};

function chipClass(tag) {
  return TAG_CLASS[tag.toUpperCase()] || 'other';
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

function sizeDiff(orig, clean) {
  const savedKb = ((orig - clean) / 1024).toFixed(1);
  const origKb  = (orig / 1024).toFixed(1);
  if (orig === clean) return `${origKb} KB`;
  return `${origKb} → ${(clean/1024).toFixed(1)} KB`;
}

// ── History: render list ──────────────────────────────────────────────────────
function renderHistory(entries) {
  // Remove old items (keep empty state node)
  historyList.querySelectorAll('.history-item').forEach(el => el.remove());

  if (!entries || entries.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  entries.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'history-item';

    const fields = entry.removedFields || [];
    const chipsHtml = fields.length > 0
      ? fields.map(f =>
          `<span class="meta-chip ${chipClass(f.tag)}" title="${f.label}">${f.tag}</span>`
        ).join('')
      : '<span class="no-meta-label">No metadata detected</span>';

    item.innerHTML = `
      <div class="history-item-header">
        <span class="history-item-name" title="${entry.name}">${entry.name}</span>
        <span class="history-item-size">${sizeDiff(entry.originalSize, entry.cleanSize)}</span>
      </div>
      <div class="history-item-meta">${chipsHtml}</div>
      <div class="history-item-footer">
        <span class="history-site">${entry.site || 'unknown site'}</span>
        <span class="history-time">${timeAgo(entry.timestamp)}</span>
      </div>
    `;
    historyList.appendChild(item);
  });
}

// ── Screen transitions ────────────────────────────────────────────────────────
function showHistory() {
  chrome.storage.local.get(['coffeeHistory'], (result) => {
    renderHistory(result.coffeeHistory || []);
  });
  screensWrapper.classList.add('show-history');
}

function showMain() {
  screensWrapper.classList.remove('show-history');
}

// ── Load initial state ────────────────────────────────────────────────────────
chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
  if (chrome.runtime.lastError) {
    chrome.storage.sync.get(['coffeeEnabled', 'coffeeCleanCount'], (data) => {
      renderEnabled(data.coffeeEnabled !== false);
      renderCount(data.coffeeCleanCount || 0);
    });
    return;
  }
  renderEnabled(response.enabled);
  renderCount(response.cleanCount);
});

// ── Toggle ────────────────────────────────────────────────────────────────────
toggleInput.addEventListener('change', () => {
  renderEnabled(toggleInput.checked);
  chrome.runtime.sendMessage({ action: 'setEnabled', value: toggleInput.checked });
});

// ── Reset counter ─────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'resetCount' }, () => renderCount(0));
});

// ── History navigation ────────────────────────────────────────────────────────
historyBtn.addEventListener('click', showHistory);
backBtn.addEventListener('click', showMain);

clearHistoryBtn.addEventListener('click', () => {
  chrome.storage.local.set({ coffeeHistory: [] }, () => {
    renderHistory([]);
  });
});

// ── Live updates while popup is open ─────────────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.coffeeCleanCount) {
    renderCount(changes.coffeeCleanCount.newValue || 0);
    bumpCount();
  }
  if (changes.coffeeEnabled !== undefined) {
    renderEnabled(changes.coffeeEnabled.newValue !== false);
  }
});
