/**
 * Web Highlighter - Content Script (content.js)
 * Handles text selection, floating toolbar, multi-element range wrapping,
 * persistent storage (chrome.storage.local), and click-to-edit interactions.
 */

(function () {
  'use strict';

  if (window.__WEB_HIGHLIGHTER_LOADED__) return;
  window.__WEB_HIGHLIGHTER_LOADED__ = true;

  const HIGHLIGHT_COLORS = [
    { name: 'Yellow', color: '#fef08a', label: 'Yellow' },
    { name: 'Green', color: '#bbf7d0', label: 'Green' },
    { name: 'Blue', color: '#bfdbfe', label: 'Blue' },
    { name: 'Pink', color: '#fbcfe8', label: 'Pink' },
    { name: 'Orange', color: '#fed7aa', label: 'Orange' },
    { name: 'Purple', color: '#e9d5ff', label: 'Purple' }
  ];

  let defaultColor = '#fef08a';
  let floatingToolbar = null;
  let activePopover = null;
  let currentSelectionRange = null;
  let currentSelectedText = '';
  let activeHighlightId = null;

  function getStorageKey() {
    try {
      const url = new URL(window.location.href);
      return 'web_hl_' + url.origin + url.pathname;
    } catch {
      return 'web_hl_' + window.location.href.split('#')[0];
    }
  }

  function initSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['web_hl_default_color'], (result) => {
        if (result.web_hl_default_color) {
          defaultColor = result.web_hl_default_color;
        }
      });
    }
  }

  function createFloatingToolbar() {
    if (floatingToolbar) return floatingToolbar;

    const toolbar = document.createElement('div');
    toolbar.id = 'web-hl-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Web Highlighter toolbar');

    const swatches = document.createElement('div');
    swatches.className = 'web-hl-swatch-list';

    HIGHLIGHT_COLORS.forEach(({ name, color, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'web-hl-swatch web-hl-tooltip';
      btn.style.backgroundColor = color;
      btn.dataset.color = color;
      btn.dataset.tooltip = label;
      btn.setAttribute('aria-label', `Highlight ${name}`);

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (currentSelectionRange) {
          applyHighlight(currentSelectionRange, color, currentSelectedText);
          hideToolbar();
        }
      });

      swatches.appendChild(btn);
    });

    toolbar.appendChild(swatches);

    const divider = document.createElement('div');
    divider.className = 'web-hl-divider';
    toolbar.appendChild(divider);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'web-hl-btn';
    closeBtn.title = 'Dismiss';
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;
    closeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideToolbar();
    });
    toolbar.appendChild(closeBtn);

    toolbar.addEventListener('mousedown', (e) => e.stopPropagation());

    document.body.appendChild(toolbar);
    floatingToolbar = toolbar;
    return toolbar;
  }

  function createHighlightPopover() {
    if (activePopover) return activePopover;

    const popover = document.createElement('div');
    popover.id = 'web-hl-popover';

    const swatches = document.createElement('div');
    swatches.className = 'web-hl-swatch-list';

    HIGHLIGHT_COLORS.forEach(({ name, color, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'web-hl-swatch web-hl-tooltip';
      btn.style.backgroundColor = color;
      btn.dataset.color = color;
      btn.dataset.tooltip = `Change to ${label}`;

      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (activeHighlightId) {
          updateHighlightColor(activeHighlightId, color);
          hidePopover();
        }
      });

      swatches.appendChild(btn);
    });

    popover.appendChild(swatches);

    const divider = document.createElement('div');
    divider.className = 'web-hl-divider';
    popover.appendChild(divider);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'web-hl-btn';
    copyBtn.title = 'Copy text';
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
    `;
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeHighlightId) {
        const text = getHighlightTextById(activeHighlightId);
        if (text) {
          navigator.clipboard.writeText(text).then(() => {
            copyBtn.style.color = '#4ade80';
            setTimeout(() => {
              copyBtn.style.color = '';
              hidePopover();
            }, 600);
          });
        }
      }
    });
    popover.appendChild(copyBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'web-hl-btn web-hl-btn-danger';
    deleteBtn.title = 'Remove highlight';
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </svg>
    `;
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeHighlightId) {
        removeHighlightById(activeHighlightId);
        hidePopover();
      }
    });
    popover.appendChild(deleteBtn);

    popover.addEventListener('mousedown', (e) => e.stopPropagation());

    document.body.appendChild(popover);
    activePopover = popover;
    return popover;
  }

  function showToolbarAtRange(range) {
    const toolbar = createFloatingToolbar();
    const rect = range.getBoundingClientRect();

    if (rect.width === 0 && rect.height === 0) {
      hideToolbar();
      return;
    }

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    toolbar.classList.remove('web-hl-arrow-top');

    const toolbarWidth = 230;
    const toolbarHeight = 44;

    let left = rect.left + scrollX + rect.width / 2 - toolbarWidth / 2;
    let top = rect.top + scrollY - toolbarHeight - 10;

    const minLeft = scrollX + 10;
    const maxLeft = scrollX + window.innerWidth - toolbarWidth - 10;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    if (rect.top - toolbarHeight - 12 < 0) {
      top = rect.bottom + scrollY + 10;
      toolbar.classList.add('web-hl-arrow-top');
    }

    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
    toolbar.classList.add('web-hl-visible');
  }

  function hideToolbar() {
    if (floatingToolbar) {
      floatingToolbar.classList.remove('web-hl-visible');
    }
  }

  function showPopoverAtElement(targetEl, highlightId) {
    activeHighlightId = highlightId;
    const popover = createHighlightPopover();
    const rect = targetEl.getBoundingClientRect();

    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    popover.classList.remove('web-hl-arrow-top');

    const popoverWidth = 240;
    const popoverHeight = 44;

    let left = rect.left + scrollX + rect.width / 2 - popoverWidth / 2;
    let top = rect.top + scrollY - popoverHeight - 10;

    const minLeft = scrollX + 10;
    const maxLeft = scrollX + window.innerWidth - popoverWidth - 10;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    if (rect.top - popoverHeight - 12 < 0) {
      top = rect.bottom + scrollY + 10;
      popover.classList.add('web-hl-arrow-top');
    }

    const currentColor = targetEl.dataset.hlColor || targetEl.style.backgroundColor;
    popover.querySelectorAll('.web-hl-swatch').forEach((swatch) => {
      if (swatch.dataset.color === currentColor) {
        swatch.classList.add('active');
      } else {
        swatch.classList.remove('active');
      }
    });

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.classList.add('web-hl-visible');
  }

  function hidePopover() {
    if (activePopover) {
      activePopover.classList.remove('web-hl-visible');
      activeHighlightId = null;
    }
  }

  function handleSelection() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hideToolbar();
      currentSelectionRange = null;
      currentSelectedText = '';
      return;
    }

    const text = selection.toString().trim();
    if (text.length === 0) {
      hideToolbar();
      return;
    }

    const range = selection.getRangeAt(0);

    let container = range.commonAncestorContainer;
    if (container.nodeType === Node.TEXT_NODE) container = container.parentNode;

    if (
      container.closest('#web-hl-toolbar') ||
      container.closest('#web-hl-popover') ||
      container.closest('input, textarea, select, [contenteditable="true"]')
    ) {
      return;
    }

    currentSelectionRange = range.cloneRange();
    currentSelectedText = text;
    hidePopover();
    showToolbarAtRange(range);
  }

  function getIntersectingTextNodes(range) {
    const textNodes = [];
    const root = range.commonAncestorContainer;

    if (root.nodeType === Node.TEXT_NODE) {
      return [root];
    }

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.textContent || node.textContent.length === 0) {
            return NodeFilter.FILTER_SKIP;
          }
          const nodeRange = document.createRange();
          nodeRange.selectNodeContents(node);
          const isBefore = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) >= 0;
          const isAfter = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) <= 0;
          return (!isBefore && !isAfter) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let curr = walker.nextNode();
    while (curr) {
      textNodes.push(curr);
      curr = walker.nextNode();
    }
    return textNodes;
  }

  function wrapRangeInMark(range, highlightId, color) {
    const textNodes = getIntersectingTextNodes(range);
    if (textNodes.length === 0) return [];

    const createdMarks = [];

    textNodes.forEach((node) => {
      const isStart = node === range.startContainer;
      const isEnd = node === range.endContainer;

      const startOffset = isStart ? range.startOffset : 0;
      const endOffset = isEnd ? range.endOffset : node.textContent.length;

      if (startOffset >= endOffset) return;

      const fullText = node.textContent;
      const beforeText = fullText.slice(0, startOffset);
      const highlightText = fullText.slice(startOffset, endOffset);
      const afterText = fullText.slice(endOffset);

      if (!highlightText) return;

      const existingMark = node.parentElement ? node.parentElement.closest('.web-hl-mark') : null;
      if (existingMark) {
        existingMark.dataset.hlId = highlightId;
        existingMark.dataset.hlColor = color;
        existingMark.style.backgroundColor = color;
        createdMarks.push(existingMark);
        return;
      }

      const parent = node.parentNode;
      if (!parent) return;

      const mark = document.createElement('mark');
      mark.className = 'web-hl-mark';
      mark.dataset.hlId = highlightId;
      mark.dataset.hlColor = color;
      mark.style.backgroundColor = color;
      mark.textContent = highlightText;

      bindMarkEvents(mark);

      const fragment = document.createDocumentFragment();
      if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
      fragment.appendChild(mark);
      if (afterText) fragment.appendChild(document.createTextNode(afterText));

      parent.replaceChild(fragment, node);
      createdMarks.push(mark);
    });

    return createdMarks;
  }

  function bindMarkEvents(mark) {
    mark.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hlId = mark.dataset.hlId;
      if (hlId) {
        hideToolbar();
        showPopoverAtElement(mark, hlId);
      }
    });

    mark.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const hlId = mark.dataset.hlId;
      if (hlId) {
        hideToolbar();
        showPopoverAtElement(mark, hlId);
      }
    });
  }

  function getSurroundingContext(range) {
    const fullText = document.body.innerText || '';
    const prefix = fullText.substring(0, 30);
    const suffix = fullText.substring(fullText.length - 30);
    return { prefix, suffix };
  }

  function applyHighlight(range, color, text) {
    const highlightId = 'hl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const marks = wrapRangeInMark(range, highlightId, color);

    if (marks.length === 0) return;

    if (window.getSelection) {
      window.getSelection().removeAllRanges();
    }

    const { prefix, suffix } = getSurroundingContext(range);
    const highlightRecord = {
      id: highlightId,
      text: text || marks.map(m => m.textContent).join(''),
      color: color,
      createdAt: Date.now(),
      prefix: prefix,
      suffix: suffix,
      url: window.location.href
    };

    saveHighlightToStorage(highlightRecord);
  }

  function saveHighlightToStorage(record) {
    const key = getStorageKey();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (data) => {
        const list = data[key] || [];
        list.push(record);
        chrome.storage.local.set({ [key]: list }, () => {
          notifyBadgeUpdate(list.length);
        });
      });
    } else {
      try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        list.push(record);
        localStorage.setItem(key, JSON.stringify(list));
      } catch (err) {
        console.error('Storage error:', err);
      }
    }
  }

  function getHighlightTextById(highlightId) {
    const marks = document.querySelectorAll(`.web-hl-mark[data-hl-id="${highlightId}"]`);
    return Array.from(marks).map(m => m.textContent).join('');
  }

  function updateHighlightColor(highlightId, newColor) {
    const marks = document.querySelectorAll(`.web-hl-mark[data-hl-id="${highlightId}"]`);
    marks.forEach(m => {
      m.style.backgroundColor = newColor;
      m.dataset.hlColor = newColor;
    });

    const key = getStorageKey();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (data) => {
        const list = data[key] || [];
        const item = list.find(h => h.id === highlightId);
        if (item) {
          item.color = newColor;
          chrome.storage.local.set({ [key]: list });
        }
      });
    } else {
      try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        const item = list.find(h => h.id === highlightId);
        if (item) {
          item.color = newColor;
          localStorage.setItem(key, JSON.stringify(list));
        }
      } catch (err) {
        console.error(err);
      }
    }
  }

  function removeHighlightById(highlightId) {
    const marks = document.querySelectorAll(`.web-hl-mark[data-hl-id="${highlightId}"]`);
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });

    const key = getStorageKey();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (data) => {
        const list = (data[key] || []).filter(h => h.id !== highlightId);
        chrome.storage.local.set({ [key]: list }, () => {
          notifyBadgeUpdate(list.length);
        });
      });
    } else {
      try {
        const list = (JSON.parse(localStorage.getItem(key) || '[]')).filter(h => h.id !== highlightId);
        localStorage.setItem(key, JSON.stringify(list));
      } catch (err) {
        console.error(err);
      }
    }
  }

  function clearAllHighlightsOnPage() {
    const marks = document.querySelectorAll('.web-hl-mark');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });

    const key = getStorageKey();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove([key], () => {
        notifyBadgeUpdate(0);
      });
    } else {
      try {
        localStorage.removeItem(key);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function notifyBadgeUpdate(count) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ action: 'UPDATE_BADGE_COUNT', count: count }).catch(() => {});
    }
  }

  function findTextAndWrap(searchText, highlightId, color) {
    if (!searchText || !searchText.trim()) return false;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_SKIP;
        const p = node.parentElement;
        if (p && (p.closest('#web-hl-toolbar') || p.closest('#web-hl-popover') || p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node = walker.nextNode();
    while (node) {
      const idx = node.textContent.indexOf(searchText);
      if (idx !== -1) {
        if (node.parentElement && node.parentElement.dataset.hlId === highlightId) {
          return true;
        }
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + searchText.length);
        wrapRangeInMark(range, highlightId, color);
        return true;
      }
      node = walker.nextNode();
    }

    return findMultiNodeTextAndWrap(searchText, highlightId, color);
  }

  function findMultiNodeTextAndWrap(searchText, highlightId, color) {
    const cleanSearch = searchText.replace(/\s+/g, ' ').trim();
    if (!cleanSearch) return false;

    const allTextNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const p = node.parentElement;
        if (p && (p.closest('#web-hl-toolbar') || p.closest('#web-hl-popover') || p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node = walker.nextNode();
    let accumulatedText = '';
    const nodeOffsets = [];

    while (node) {
      const start = accumulatedText.length;
      accumulatedText += node.textContent;
      const end = accumulatedText.length;
      allTextNodes.push(node);
      nodeOffsets.push({ node, start, end });
      node = walker.nextNode();
    }

    const matchIndex = accumulatedText.indexOf(searchText);
    if (matchIndex === -1) return false;

    const matchEnd = matchIndex + searchText.length;

    let startContainer = null;
    let startOffset = 0;
    let endContainer = null;
    let endOffset = 0;

    for (let i = 0; i < nodeOffsets.length; i++) {
      const info = nodeOffsets[i];
      if (!startContainer && matchIndex >= info.start && matchIndex < info.end) {
        startContainer = info.node;
        startOffset = matchIndex - info.start;
      }
      if (!endContainer && matchEnd > info.start && matchEnd <= info.end) {
        endContainer = info.node;
        endOffset = matchEnd - info.start;
      }
    }

    if (startContainer && endContainer) {
      const range = document.createRange();
      range.setStart(startContainer, startOffset);
      range.setEnd(endContainer, endOffset);
      wrapRangeInMark(range, highlightId, color);
      return true;
    }

    return false;
  }

  function restoreHighlights() {
    const key = getStorageKey();
    const handleStoredList = (list) => {
      if (!Array.isArray(list) || list.length === 0) {
        notifyBadgeUpdate(0);
        return;
      }
      list.forEach(item => {
        findTextAndWrap(item.text, item.id, item.color);
      });
      notifyBadgeUpdate(list.length);
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([key], (data) => {
        handleStoredList(data[key] || []);
      });
    } else {
      try {
        const list = JSON.parse(localStorage.getItem(key) || '[]');
        handleStoredList(list);
      } catch (err) {
        console.error(err);
      }
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'GET_HIGHLIGHTS') {
        const key = getStorageKey();
        chrome.storage.local.get([key], (data) => {
          sendResponse({ highlights: data[key] || [], url: window.location.href });
        });
        return true;
      }

      if (request.action === 'CLEAR_ALL_HIGHLIGHTS') {
        clearAllHighlightsOnPage();
        sendResponse({ success: true });
        return true;
      }

      if (request.action === 'REMOVE_HIGHLIGHT') {
        removeHighlightById(request.highlightId);
        sendResponse({ success: true });
        return true;
      }

      if (request.action === 'UPDATE_HIGHLIGHT_COLOR') {
        updateHighlightColor(request.highlightId, request.color);
        sendResponse({ success: true });
        return true;
      }

      if (request.action === 'SCROLL_TO_HIGHLIGHT') {
        const mark = document.querySelector(`.web-hl-mark[data-hl-id="${request.highlightId}"]`);
        if (mark) {
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
          mark.classList.add('web-hl-pulse');
          setTimeout(() => mark.classList.remove('web-hl-pulse'), 2500);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false });
        }
        return true;
      }

      if (request.action === 'APPLY_DEFAULT_HIGHLIGHT') {
        if (currentSelectionRange && currentSelectedText) {
          applyHighlight(currentSelectionRange, request.color || defaultColor, currentSelectedText);
          hideToolbar();
          sendResponse({ success: true });
        } else {
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed) {
            const range = sel.getRangeAt(0);
            applyHighlight(range, request.color || defaultColor, sel.toString().trim());
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, reason: 'No text selected' });
          }
        }
        return true;
      }
    });
  }

  document.addEventListener('mouseup', () => {
    setTimeout(handleSelection, 10);
  });

  document.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA'].includes(e.code)) {
      setTimeout(handleSelection, 10);
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (floatingToolbar && !floatingToolbar.contains(e.target)) {
      hideToolbar();
    }
    if (activePopover && !activePopover.contains(e.target)) {
      hidePopover();
    }
  });

  let lastUrl = window.location.href;
  const observer = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      setTimeout(restoreHighlights, 500);
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  initSettings();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreHighlights);
  } else {
    restoreHighlights();
  }
})();