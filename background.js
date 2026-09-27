/**
 * Web Highlighter - Background Service Worker (background.js)
 * Manages context menus, badge indicators, and extension lifecycle.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'web-hl-highlight-selection',
    title: 'Highlight selection with default color',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'web-hl-clear-page',
    title: 'Clear all highlights on this page',
    contexts: ['page']
  });

  chrome.storage.local.get(['web_hl_default_color'], (result) => {
    if (!result.web_hl_default_color) {
      chrome.storage.local.set({ web_hl_default_color: '#fef08a' });
    }
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === 'web-hl-highlight-selection') {
    chrome.storage.local.get(['web_hl_default_color'], (res) => {
      const color = res.web_hl_default_color || '#fef08a';
      chrome.tabs.sendMessage(tab.id, {
        action: 'APPLY_DEFAULT_HIGHLIGHT',
        color: color
      }).catch((err) => {
        console.warn('Could not communicate with tab:', err);
      });
    });
  } else if (info.menuItemId === 'web-hl-clear-page') {
    chrome.tabs.sendMessage(tab.id, {
      action: 'CLEAR_ALL_HIGHLIGHTS'
    }).catch((err) => {
      console.warn('Could not communicate with tab:', err);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'UPDATE_BADGE_COUNT') {
    const tabId = sender.tab ? sender.tab.id : null;
    const count = message.count || 0;
    const text = count > 0 ? String(count) : '';

    if (tabId) {
      chrome.action.setBadgeText({ text: text, tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId: tabId });
    } else {
      chrome.action.setBadgeText({ text: text });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
    }
    sendResponse({ ok: true });
    return true;
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (!tab || !tab.url) return;
    try {
      const url = new URL(tab.url);
      const key = 'web_hl_' + url.origin + url.pathname;
      chrome.storage.local.get([key], (data) => {
        const list = data[key] || [];
        const text = list.length > 0 ? String(list.length) : '';
        chrome.action.setBadgeText({ text: text, tabId: activeInfo.tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#f59e0b', tabId: activeInfo.tabId });
      });
    } catch {
      // Ignored for special URLs
    }
  });
});