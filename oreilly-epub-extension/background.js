// Service Worker: message relay, badge, state, progress broadcast

let state = {
  status: 'idle', // idle | downloading | complete | error
  bookInfo: null,
  progress: null,
  error: null,
  tabId: null,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'getState':
      sendResponse(state);
      return true;

    case 'startDownload':
      if (state.tabId) {
        chrome.tabs.sendMessage(state.tabId, { action: 'startDownload' });
      }
      return true;

    case 'cancelDownload':
      if (state.tabId) {
        chrome.tabs.sendMessage(state.tabId, { action: 'cancelDownload' });
      }
      state.status = 'idle';
      state.progress = null;
      chrome.action.setBadgeText({ text: '' });
      return true;

    case 'bookDetected':
      state.tabId = sender.tab?.id || null;
      state.bookInfo = message.bookInfo;
      state.status = 'idle';
      state.progress = null;
      state.error = null;
      sendResponse({ ok: true });
      return true;

    case 'progress':
      state.status = 'downloading';
      state.progress = {
        chapter: message.chapter,
        totalChapters: message.totalChapters,
        images: message.images,
        totalImages: message.totalImages,
      };
      chrome.action.setBadgeText({
        text: `${message.chapter}/${message.totalChapters}`,
      });
      chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
      chrome.runtime.sendMessage({
        action: 'progressUpdate',
        ...state.progress,
      }).catch(() => {});
      return true;

    case 'downloadComplete':
      state.status = 'complete';
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
      chrome.runtime.sendMessage({ action: 'downloadComplete' }).catch(() => {});
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
        state.status = 'idle';
      }, 5000);
      return true;

    case 'downloadError':
      state.status = 'error';
      state.error = message.error;
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
      chrome.runtime.sendMessage({
        action: 'downloadError',
        error: message.error,
      }).catch(() => {});
      if (message.error && message.error.includes('Session expired')) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'O\'Reilly EPUB Exporter',
          message: 'Session expired. Please log in to O\'Reilly and try again.',
        });
      }
      return true;
  }
});
