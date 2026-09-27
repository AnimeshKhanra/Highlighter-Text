/**
 * Web Highlighter - Popup Controller (popup.js)
 */

document.addEventListener('DOMContentLoaded', async () => {
  const pageHostEl = document.getElementById('page-host');
  const badgeCountEl = document.getElementById('badge-count');
  const itemsCountEl = document.getElementById('items-count');
  const highlightsListEl = document.getElementById('highlights-list');
  const emptyStateEl = document.getElementById('empty-state');
  const searchInput = document.getElementById('search-input');
  const btnClearAll = document.getElementById('btn-clear-all');
  const btnExport = document.getElementById('btn-export');
  const defaultSwatches = document.getElementById('default-swatches');
  const customColorInput = document.getElementById('custom-color-input');

  let currentTab = null;
  let allHighlights = [];
  let currentStorageKey = '';

  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0];
  }

  if (currentTab && currentTab.url) {
    try {
      const parsed = new URL(currentTab.url);
      pageHostEl.textContent = parsed.hostname + (parsed.pathname.length > 1 ? parsed.pathname : '');
      currentStorageKey = 'web_hl_' + parsed.origin + parsed.pathname;
    } catch {
      pageHostEl.textContent = currentTab.title || 'Current Webpage';
      currentStorageKey = 'web_hl_' + (currentTab.url || '').split('#')[0];
    }
  } else {
    pageHostEl.textContent = 'Active Page';
  }

  function initDefaultColor() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['web_hl_default_color'], (result) => {
        const color = result.web_hl_default_color || '#fef08a';
        setSelectedSwatch(color);
      });
    }
  }

  function setSelectedSwatch(color) {
    const swatches = defaultSwatches.querySelectorAll('.swatch-btn');
    swatches.forEach(btn => {
      if (btn.dataset.color.toLowerCase() === color.toLowerCase()) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    customColorInput.value = color;
  }

  function saveDefaultColor(color) {
    setSelectedSwatch(color);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ web_hl_default_color: color });
    }
  }

  defaultSwatches.addEventListener('click', (e) => {
    const btn = e.target.closest('.swatch-btn');
    if (btn && btn.dataset.color) {
      saveDefaultColor(btn.dataset.color);
    }
  });

  customColorInput.addEventListener('input', (e) => {
    saveDefaultColor(e.target.value);
  });

  function loadHighlights() {
    if (currentTab && currentTab.id) {
      chrome.tabs.sendMessage(currentTab.id, { action: 'GET_HIGHLIGHTS' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          fallbackLoadFromStorage();
          return;
        }
        allHighlights = response.highlights || [];
        renderList(allHighlights);
      });
    } else {
      fallbackLoadFromStorage();
    }
  }

  function fallbackLoadFromStorage() {
    if (!currentStorageKey) {
      renderList([]);
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([currentStorageKey], (data) => {
        allHighlights = data[currentStorageKey] || [];
        renderList(allHighlights);
      });
    }
  }

  function renderList(items) {
    const filterQuery = (searchInput.value || '').trim().toLowerCase();
    const filtered = filterQuery
      ? items.filter(i => (i.text || '').toLowerCase().includes(filterQuery))
      : items;

    badgeCountEl.textContent = String(items.length);
    itemsCountEl.textContent = String(items.length);

    highlightsListEl.innerHTML = '';

    if (filtered.length === 0) {
      emptyStateEl.classList.add('visible');
      highlightsListEl.style.display = 'none';
      return;
    }

    emptyStateEl.classList.remove('visible');
    highlightsListEl.style.display = 'flex';

    filtered.forEach(hl => {
      const itemEl = document.createElement('div');
      itemEl.className = 'highlight-item';

      const timeFormatted = hl.createdAt
        ? new Date(hl.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';

      itemEl.innerHTML = `
        <div class="color-indicator" style="background-color: ${hl.color || '#fef08a'};"></div>
        <div class="highlight-content">
          <div class="highlight-text" title="${escapeHtml(hl.text)}">${escapeHtml(hl.text)}</div>
          <div class="highlight-meta">
            <span class="highlight-time">${timeFormatted}</span>
            <div class="item-actions">
              <button type="button" class="action-icon-btn btn-copy" title="Copy text">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <button type="button" class="action-icon-btn btn-delete" title="Delete highlight">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;

      itemEl.addEventListener('click', (e) => {
        if (e.target.closest('.action-icon-btn')) return;
        if (currentTab && currentTab.id) {
          chrome.tabs.sendMessage(currentTab.id, {
            action: 'SCROLL_TO_HIGHLIGHT',
            highlightId: hl.id
          });
        }
      });

      const copyBtn = itemEl.querySelector('.btn-copy');
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(hl.text).then(() => {
          copyBtn.style.color = '#10b981';
          setTimeout(() => { copyBtn.style.color = ''; }, 800);
        });
      });

      const deleteBtn = itemEl.querySelector('.btn-delete');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHighlight(hl.id);
      });

      highlightsListEl.appendChild(itemEl);
    });
  }

  function deleteHighlight(highlightId) {
    if (currentTab && currentTab.id) {
      chrome.tabs.sendMessage(currentTab.id, {
        action: 'REMOVE_HIGHLIGHT',
        highlightId: highlightId
      }, () => {
        allHighlights = allHighlights.filter(h => h.id !== highlightId);
        renderList(allHighlights);
      });
    } else if (currentStorageKey) {
      allHighlights = allHighlights.filter(h => h.id !== highlightId);
      chrome.storage.local.set({ [currentStorageKey]: allHighlights }, () => {
        renderList(allHighlights);
      });
    }
  }

  btnClearAll.addEventListener('click', () => {
    if (allHighlights.length === 0) return;
    if (!confirm('Are you sure you want to remove all highlights from this page?')) return;

    if (currentTab && currentTab.id) {
      chrome.tabs.sendMessage(currentTab.id, { action: 'CLEAR_ALL_HIGHLIGHTS' }, () => {
        allHighlights = [];
        renderList([]);
      });
    } else if (currentStorageKey) {
      chrome.storage.local.remove([currentStorageKey], () => {
        allHighlights = [];
        renderList([]);
      });
    }
  });

  searchInput.addEventListener('input', () => {
    renderList(allHighlights);
  });

  btnExport.addEventListener('click', () => {
    if (allHighlights.length === 0) {
      alert('No highlights to export.');
      return;
    }
    const pageTitle = currentTab ? (currentTab.title || 'Page Highlights') : 'Page Highlights';
    const pageUrl = currentTab ? (currentTab.url || '') : '';
    let markdown = `# Highlights from: ${pageTitle}\nSource: ${pageUrl}\nDate: ${new Date().toLocaleDateString()}\n\n---\n\n`;

    allHighlights.forEach((hl, i) => {
      markdown += `### Highlight ${i + 1}\n> "${hl.text}"\n\n*Color: ${hl.color}*\n\n`;
    });

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `highlights-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(blobUrl);
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  initDefaultColor();
  loadHighlights();
});