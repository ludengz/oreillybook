// Service Worker: message relay, badge, state, progress broadcast
// Uses chrome.storage.session to survive SW termination (MV3 lifecycle)

const DEFAULT_STATE = {
  status: 'idle', // idle | downloading | complete | error
  bookInfo: null,
  progress: null,
  error: null,
  tabId: null,
};

async function getState() {
  const result = await chrome.storage.session.get('state');
  return result.state || { ...DEFAULT_STATE };
}

async function setState(updates) {
  const current = await getState();
  const next = { ...current, ...updates };
  await chrome.storage.session.set({ state: next });
  return next;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Wrap async handler so sendResponse works
  (async () => {
    switch (message.action) {
      case 'getState':
        sendResponse(await getState());
        return;

      case 'startDownload': {
        const st = await getState();
        if (st.tabId) {
          chrome.tabs.sendMessage(st.tabId, { action: 'startDownload' });
        }
        return;
      }

      case 'cancelDownload': {
        const st = await getState();
        if (st.tabId) {
          chrome.tabs.sendMessage(st.tabId, { action: 'cancelDownload' });
        }
        await setState({ status: 'idle', progress: null });
        chrome.action.setBadgeText({ text: '' });
        return;
      }

      case 'bookDetected':
        await setState({
          tabId: sender.tab?.id || null,
          bookInfo: message.bookInfo,
          status: 'idle',
          progress: null,
          error: null,
        });
        sendResponse({ ok: true });
        return;

      case 'progress': {
        const progress = {
          chapter: message.chapter,
          totalChapters: message.totalChapters,
          images: message.images,
          totalImages: message.totalImages,
        };
        await setState({ status: 'downloading', progress });
        chrome.action.setBadgeText({
          text: `${message.chapter}/${message.totalChapters}`,
        });
        chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
        chrome.runtime.sendMessage({
          action: 'progressUpdate',
          ...progress,
        }).catch(() => {});
        return;
      }

      case 'downloadComplete':
        await setState({ status: 'complete' });
        chrome.action.setBadgeText({ text: '✓' });
        chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
        chrome.runtime.sendMessage({ action: 'downloadComplete' }).catch(() => {});
        setTimeout(async () => {
          chrome.action.setBadgeText({ text: '' });
          await setState({ status: 'idle' });
        }, 5000);
        return;

      case 'downloadError':
        await setState({ status: 'error', error: message.error });
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
        return;

      case 'fetchImage': {
        // CORS proxy: fetch image from SW context (bypasses content script CORS)
        try {
          const response = await fetch(message.url, { credentials: 'include' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const buffer = await response.arrayBuffer();
          // Convert to base64 for message passing (ArrayBuffer can't be sent)
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          sendResponse({ ok: true, data: btoa(binary) });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        return;
      }
    }
  })();
  return true; // Keep message channel open for async response
});
