// Tests for background.js state management around startDownload.
// background.js registers the SECOND runtime.onMessage listener (see load
// order in test-runner.html).
const BACKGROUND_LISTENER = 1;

describe('background.js startDownload state management', function() {
  it('rolls back to idle and reports failure when the content script is unreachable', async function() {
    ChromeMock.resetStorage();
    ChromeMock.setTabsSendMessage(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });

    const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'startDownload', tabId: 42 });

    assert(response && response.ok === false,
      `expected ok:false response, got ${JSON.stringify(response)}`);
    const state = ChromeMock.getStorage().state;
    assertEqual(state ? state.status : '(no state)', 'idle', 'state should roll back to idle');
    assertEqual(state ? state.downloadingTabId : '(no state)', null, 'downloadingTabId should be cleared');
  });

  it('enters downloading state when the content script is reachable', async function() {
    ChromeMock.resetStorage();
    ChromeMock.setTabsSendMessage(async () => undefined);

    const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'startDownload', tabId: 7 });

    assert(response && response.ok === true, `expected ok:true, got ${JSON.stringify(response)}`);
    const state = ChromeMock.getStorage().state;
    assertEqual(state.status, 'downloading');
    assertEqual(state.downloadingTabId, 7);
  });

  it('rejects startDownload without a tab id', async function() {
    ChromeMock.resetStorage();
    const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'startDownload' });
    assert(response && response.ok === false,
      `expected ok:false for missing tabId, got ${JSON.stringify(response)}`);
    const state = ChromeMock.getStorage().state;
    assert(!state || state.status !== 'downloading', 'must not enter downloading state without a tab');
  });
});

describe('background.js attempt guards and stable complete state', function() {
  // Start a download on the given tab; returns the attemptId the SW issued
  async function startAttempt(tabId, initialState) {
    ChromeMock.resetStorage(initialState ? { state: initialState } : {});
    ChromeMock.clearBadgeEvents();
    let sentAttemptId = null;
    ChromeMock.setTabsSendMessage(async (id, msg) => { sentAttemptId = msg.attemptId; });
    const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'startDownload', tabId });
    assert(response && response.ok === true, `start failed: ${JSON.stringify(response)}`);
    return sentAttemptId;
  }
  const sender = (tabId) => ({ tab: { id: tabId } });

  it('issues an attemptId, stores it, and passes it to the content script', async function() {
    const attemptId = await startAttempt(5);
    assert(attemptId, 'startDownload command must carry an attemptId');
    assertEqual(ChromeMock.getStorage().state.attemptId, attemptId,
      'the issued attemptId must be stored in session state');
  });

  it('accepts progress from the current attempt and scopes the badge to the tab', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'progress', attemptId, chapter: 1, totalChapters: 3, images: 0, totalImages: 0 },
      sender(5));
    const state = ChromeMock.getStorage().state;
    assertEqual(state.progress && state.progress.chapter, 1);
    const badge = ChromeMock.badgeEvents.find(e => e.kind === 'text' && e.text === '1/3');
    assert(badge, 'progress badge expected');
    assertEqual(badge.tabId, 5, 'badge must be scoped to the downloading tab');
  });

  it('drops progress with a stale attemptId after cancel (no status resurrection)', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'cancelDownload' });
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'progress', attemptId, chapter: 2, totalChapters: 3, images: 0, totalImages: 0 },
      sender(5));
    const state = ChromeMock.getStorage().state;
    assertEqual(state.status, 'idle', 'a late progress message must not resurrect downloading');
    assertEqual(state.progress, null, 'stale progress payload must be dropped');
  });

  it('drops downloadComplete with a stale attemptId (cancel wins the race)', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'cancelDownload' });
    ChromeMock.clearBadgeEvents();
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId }, sender(5));
    const state = ChromeMock.getStorage().state;
    assertEqual(state.status, 'idle', 'a late downloadComplete must not mint a complete state');
    assert(!ChromeMock.badgeEvents.some(e => e.text === '✓'),
      'no success badge after a cancelled attempt');
  });

  it('drops lifecycle messages whose sender is not the downloading tab', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'progress', attemptId, chapter: 1, totalChapters: 3, images: 0, totalImages: 0 },
      sender(9));
    assertEqual(ChromeMock.getStorage().state.progress, null,
      'messages from the wrong tab must be dropped');
  });

  it('downloadComplete yields a stable complete state with a tab-scoped badge', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId }, sender(5));
    const state = ChromeMock.getStorage().state;
    assertEqual(state.status, 'complete');
    assertEqual(state.downloadingTabId, null);
    assertEqual(state.attemptId, null, 'no active attempt after completion');
    const badge = ChromeMock.badgeEvents.find(e => e.kind === 'text' && e.text === '✓');
    assert(badge, 'success badge expected');
    assertEqual(badge.tabId, 5, 'success badge must be scoped to the completed tab');
    // Stable: a fresh state read a beat later still reports complete
    await new Promise(r => setTimeout(r, 50));
    assertEqual(ChromeMock.getStorage().state.status, 'complete',
      'complete must persist with no timer resetting it');
  });

  it('clears the starting tab\'s badge and old report when a new download begins', async function() {
    await startAttempt(5, {
      status: 'complete', progress: null, error: null, downloadingTabId: null,
      attemptId: null, bookInfoByTab: {}, reportByTab: { 5: { attemptId: 'old' } },
    });
    const state = ChromeMock.getStorage().state;
    assertEqual(state.status, 'downloading');
    assert(!state.reportByTab[5], 'the starting tab\'s previous report must be replaced');
    assert(ChromeMock.badgeEvents.some(e => e.kind === 'text' && e.text === '' && e.tabId === 5),
      'the starting tab\'s stale badge must be cleared');
  });

  it('reportAck clears the badge for the given tab without touching state', async function() {
    ChromeMock.resetStorage({ state: {
      status: 'complete', progress: null, error: null, downloadingTabId: null,
      attemptId: null, bookInfoByTab: {}, reportByTab: { 7: { attemptId: 'a' } },
    } });
    ChromeMock.clearBadgeEvents();
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'reportAck', tabId: 7 });
    assert(ChromeMock.badgeEvents.some(e => e.kind === 'text' && e.text === '' && e.tabId === 7),
      'ack must clear the tab badge');
    const state = ChromeMock.getStorage().state;
    assertEqual(state.status, 'complete', 'ack must not change status');
    assert(state.reportByTab[7], 'ack must not delete the report');
  });

  it('snapshots the report from downloadComplete into reportByTab', async function() {
    const attemptId = await startAttempt(5);
    const report = { attemptId, bookTitle: 'Snap Book', outcome: 'complete', counts: { chaptersOk: 3 } };
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId, report }, sender(5));
    const state = ChromeMock.getStorage().state;
    assert(state.reportByTab[5], 'report must be keyed by the sender tab');
    assertEqual(state.reportByTab[5].bookTitle, 'Snap Book');
    assertEqual(state.status, 'complete');
  });

  it('snapshots the partial report from downloadError into reportByTab', async function() {
    const attemptId = await startAttempt(5);
    const report = { attemptId, outcome: 'error', counts: { chaptersOk: 1 } };
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadError', attemptId, error: 'boom', report }, sender(5));
    const state = ChromeMock.getStorage().state;
    assertEqual(state.status, 'error');
    assert(state.reportByTab[5], 'error-terminated attempts must keep their partial report');
    assertEqual(state.reportByTab[5].outcome, 'error');
  });

  it('preserves the tab\'s prior report when the content script is unreachable', async function() {
    ChromeMock.resetStorage({ state: {
      status: 'complete', progress: null, error: null, downloadingTabId: null,
      attemptId: null, bookInfoByTab: {}, reportByTab: { 5: { bookTitle: 'Kept' } },
    } });
    ChromeMock.clearBadgeEvents();
    ChromeMock.setTabsSendMessage(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'startDownload', tabId: 5 });
    assert(response && response.ok === false, 'start must fail');
    const state = ChromeMock.getStorage().state;
    assertEqual(state.status, 'idle', 'state must roll back');
    assert(state.reportByTab[5] && state.reportByTab[5].bookTitle === 'Kept',
      'a download that never started must not destroy the previous report');
  });

  it('getState returns the active tab\'s report and null for other tabs', async function() {
    ChromeMock.resetStorage({ state: {
      status: 'complete', progress: null, error: null, downloadingTabId: null,
      attemptId: null, bookInfoByTab: { 5: { title: 'B', authors: ['A'] } },
      reportByTab: { 5: { bookTitle: 'B', outcome: 'complete' } },
    } });
    const forTab5 = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'getState', tabId: 5 });
    assert(forTab5.report && forTab5.report.bookTitle === 'B', 'tab 5 must see its report');
    const forTab6 = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'getState', tabId: 6 });
    assertEqual(forTab6.report, null, 'tab 6 has no report');
  });

  it('getState tolerates legacy state objects without reportByTab', async function() {
    ChromeMock.resetStorage({ state: {
      status: 'idle', progress: null, error: null, downloadingTabId: null,
      bookInfoByTab: {},
    } });
    const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'getState', tabId: 5 });
    assertEqual(response.report, null);
  });

  it('closing the report tab removes its report and residual complete status', async function() {
    ChromeMock.resetStorage({ state: {
      status: 'complete', progress: null, error: null, downloadingTabId: null,
      attemptId: null, bookInfoByTab: { 7: { title: 'X' } }, reportByTab: { 7: { attemptId: 'a' } },
    } });
    await ChromeMock.fireTabRemoved(7);
    const state = ChromeMock.getStorage().state;
    assert(!state.reportByTab[7], 'report must be removed with its tab');
    assert(!state.bookInfoByTab[7], 'book info must be removed with its tab');
    assertEqual(state.status, 'idle', 'residual complete must reset when its tab closes');
  });
});

describe('background.js terminal notifications', function() {
  async function startAttempt(tabId) {
    ChromeMock.resetStorage();
    ChromeMock.clearNotificationEvents();
    ChromeMock.clearFocusEvents();
    let sentAttemptId = null;
    ChromeMock.setTabsSendMessage(async (id, msg) => { sentAttemptId = msg.attemptId; });
    const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'startDownload', tabId });
    assert(response && response.ok === true, `start failed: ${JSON.stringify(response)}`);
    return sentAttemptId;
  }
  const sender = (tabId) => ({ tab: { id: tabId } });
  const REPORT = {
    bookTitle: 'Notify Book',
    counts: { chaptersOk: 4, imagesOk: 7, chaptersPlaceholder: 0, imagesFailed: 1, cssFailed: 0 },
    validationWarnings: [],
  };

  it('notifies with the report summary when no popup is connected', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId, report: REPORT }, sender(5));
    assertEqual(ChromeMock.notificationEvents.length, 1, 'exactly one notification');
    const n = ChromeMock.notificationEvents[0];
    assertContains(n.title, 'Notify Book');
    assertContains(n.message, '4 chapters, 7 images');
    assertContains(n.message, '1 issue(s)');
    const map = ChromeMock.getStorage().notificationTabs;
    assertEqual(map[n.id], 5, 'notification id must map to the originating tab');
  });

  it('suppresses the notification when a popup is viewing the affected tab', async function() {
    const attemptId = await startAttempt(5);
    const port = ChromeMock.connectPopup(5);
    try {
      await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
        { action: 'downloadComplete', attemptId, report: REPORT }, sender(5));
      assertEqual(ChromeMock.notificationEvents.length, 0,
        'a popup showing the affected tab suppresses the notification');
    } finally {
      port.disconnect();
    }
  });

  it('notifies when the popup is viewing a different tab', async function() {
    const attemptId = await startAttempt(5);
    const port = ChromeMock.connectPopup(9);
    try {
      await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
        { action: 'downloadComplete', attemptId, report: REPORT }, sender(5));
      assertEqual(ChromeMock.notificationEvents.length, 1,
        'suppression is tab-scoped — a popup on another tab must not swallow the signal');
    } finally {
      port.disconnect();
    }
  });

  it('notifies after the popup port disconnects', async function() {
    const attemptId = await startAttempt(5);
    ChromeMock.connectPopup(5).disconnect();
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId, report: REPORT }, sender(5));
    assertEqual(ChromeMock.notificationEvents.length, 1, 'closed popup means notify');
  });

  it('sends exactly one notification for a session-expiry error', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER, {
      action: 'downloadError', attemptId, errorKind: 'session',
      error: 'Session expired. Please log in to O\'Reilly and try again.',
    }, sender(5));
    assertEqual(ChromeMock.notificationEvents.length, 1,
      'the old special case must not double up with the generic path');
    assertEqual(ChromeMock.notificationEvents[0].title, 'Session expired');
  });

  it('uses a distinct title for validation-blocked downloads', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER, {
      action: 'downloadError', attemptId, errorKind: 'validation',
      error: 'EPUB integrity check failed: x',
    }, sender(5));
    assertEqual(ChromeMock.notificationEvents.length, 1);
    assertContains(ChromeMock.notificationEvents[0].title, 'integrity');
  });

  it('sends no notification for a stale downloadComplete after cancel', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'cancelDownload' });
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId, report: REPORT }, sender(5));
    assertEqual(ChromeMock.notificationEvents.length, 0,
      'a cancelled attempt must never produce a success notification');
  });

  it('focuses the originating window and tab when a notification is clicked', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId, report: REPORT }, sender(5));
    const n = ChromeMock.notificationEvents[0];
    ChromeMock.clearFocusEvents();
    await ChromeMock.fireNotificationClicked(n.id);
    assert(ChromeMock.focusEvents.some(e => e.kind === 'window' && e.windowId === 100 && e.focused === true),
      'the tab\'s current window must be focused');
    assert(ChromeMock.focusEvents.some(e => e.kind === 'tab' && e.tabId === 5 && e.active === true),
      'the originating tab must be activated');
  });

  it('is a graceful no-op when the clicked notification\'s tab is gone', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId, report: REPORT }, sender(5));
    const n = ChromeMock.notificationEvents[0];
    ChromeMock.clearFocusEvents();
    ChromeMock.setTabsGet(async () => { throw new Error('No tab with id'); });
    try {
      await ChromeMock.fireNotificationClicked(n.id);
      assertEqual(ChromeMock.focusEvents.length, 0, 'no focus calls for a missing tab');
    } finally {
      ChromeMock.setTabsGet(async (tabId) => ({ id: tabId, windowId: 100 }));
    }
  });

  it('drops the map entry when its notification closes', async function() {
    const attemptId = await startAttempt(5);
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'downloadComplete', attemptId, report: REPORT }, sender(5));
    const n = ChromeMock.notificationEvents[0];
    await ChromeMock.fireNotificationClosed(n.id);
    const map = ChromeMock.getStorage().notificationTabs;
    assert(!map || map[n.id] == null, 'closed notifications must not leak map entries');
  });
});

describe('background.js bookDetected report invalidation', function() {
  const sender = (tabId) => ({ tab: { id: tabId } });
  const oldBook = { isbn: '111', title: 'Old Book', authors: ['A'] };
  const newBook = { isbn: '222', title: 'New Book', authors: ['B'] };
  const stateWithReport = (overrides = {}) => ({
    status: 'complete', progress: null, error: null, downloadingTabId: null,
    attemptId: null, bookInfoByTab: { 5: oldBook },
    reportByTab: { 5: { isbn: '111', bookTitle: 'Old Book', outcome: 'complete', counts: {} } },
    ...overrides,
  });

  it('clears the tab\'s report and residual complete status when a different book is detected', async function() {
    ChromeMock.resetStorage({ state: stateWithReport() });
    ChromeMock.clearBadgeEvents();
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'bookDetected', bookInfo: newBook }, sender(5));
    const state = ChromeMock.getStorage().state;
    assert(!state.reportByTab[5], 'a report for the old book must not outlive navigation');
    assertEqual(state.status, 'idle', 'residual complete must reset to idle');
    assertEqual(state.bookInfoByTab[5].isbn, '222', 'new book info must be stored');
    assert(ChromeMock.badgeEvents.some(e => e.kind === 'text' && e.text === '' && e.tabId === 5),
      'the stale badge must be cleared');
  });

  it('keeps the report when the same book is re-detected (same-book reload)', async function() {
    ChromeMock.resetStorage({ state: stateWithReport() });
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'bookDetected', bookInfo: oldBook }, sender(5));
    const state = ChromeMock.getStorage().state;
    assert(state.reportByTab[5], 'same-book reload must keep the report');
    assertEqual(state.status, 'complete');
  });

  it('resets an error state scoped to the navigating tab', async function() {
    ChromeMock.resetStorage({ state: stateWithReport({
      status: 'error', error: 'boom', downloadingTabId: 5,
      reportByTab: { 5: { isbn: '111', outcome: 'error', counts: {} } },
    }) });
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'bookDetected', bookInfo: newBook }, sender(5));
    const state = ChromeMock.getStorage().state;
    assert(!state.reportByTab[5], 'stale partial report must be cleared');
    assertEqual(state.status, 'idle');
    assertEqual(state.error, null);
    assertEqual(state.downloadingTabId, null);
  });

  it('does not disturb a download running on another tab', async function() {
    ChromeMock.resetStorage({ state: stateWithReport({
      status: 'downloading', downloadingTabId: 9, attemptId: 'a1',
    }) });
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'bookDetected', bookInfo: newBook }, sender(5));
    const state = ChromeMock.getStorage().state;
    assert(!state.reportByTab[5], 'stale report still clears');
    assertEqual(state.status, 'downloading', 'another tab\'s download is untouched');
    assertEqual(state.downloadingTabId, 9);
    assertEqual(state.attemptId, 'a1');
  });

  it('keeps an error state belonging to another tab', async function() {
    ChromeMock.resetStorage({ state: stateWithReport({
      status: 'error', error: 'boom', downloadingTabId: 9,
    }) });
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'bookDetected', bookInfo: newBook }, sender(5));
    const state = ChromeMock.getStorage().state;
    assert(!state.reportByTab[5], 'stale report still clears');
    assertEqual(state.status, 'error', 'another tab\'s error panel is untouched');
    assertEqual(state.downloadingTabId, 9);
  });

  it('records book info for tabs without a report', async function() {
    ChromeMock.resetStorage();
    await ChromeMock.dispatchTo(BACKGROUND_LISTENER,
      { action: 'bookDetected', bookInfo: newBook }, sender(5));
    const state = ChromeMock.getStorage().state;
    assertEqual(state.bookInfoByTab[5].isbn, '222');
    assert(!state.reportByTab[5], 'no report may appear out of nowhere');
  });
});

describe('background.js SPA navigation re-detection', function() {
  it('asks the content script to re-detect on URL change', async function() {
    let sent = null;
    ChromeMock.setTabsSendMessage(async (id, msg) => { sent = { id, msg }; });
    try {
      await ChromeMock.fireTabUpdated(5, { url: 'https://learning.oreilly.com/library/view/x/222/' });
      assert(sent && sent.msg && sent.msg.action === 'redetectBook',
        'a URL change must trigger redetectBook');
      assertEqual(sent.id, 5);
    } finally {
      ChromeMock.setTabsSendMessage(async () => undefined);
    }
  });

  it('ignores tab updates without a URL change', async function() {
    let sent = null;
    ChromeMock.setTabsSendMessage(async (id, msg) => { sent = { id, msg }; });
    try {
      await ChromeMock.fireTabUpdated(5, { status: 'loading' });
      assertEqual(sent, null, 'non-URL updates must not trigger re-detection');
    } finally {
      ChromeMock.setTabsSendMessage(async () => undefined);
    }
  });
});

describe('background.js fetchImage proxy', function() {
  async function withPatchedFetch(impl, body) {
    const orig = window.fetch;
    try {
      window.fetch = impl;
      await body();
    } finally {
      window.fetch = orig;
    }
  }

  it('returns base64 data and contentType for an allowed host', async function() {
    const bytes = new Uint8Array([1, 2, 3]);
    await withPatchedFetch(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    }), async () => {
      const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, {
        action: 'fetchImage', url: 'https://learning.oreilly.com/library/cover/123/',
      });
      assert(response && response.ok === true, `expected ok:true, got ${JSON.stringify(response)}`);
      assertEqual(response.data, btoa(String.fromCharCode(1, 2, 3)));
      assertEqual(response.contentType, 'image/jpeg');
    });
  });

  it('reports fetch failures as ok:false', async function() {
    await withPatchedFetch(async () => ({ ok: false, status: 404, headers: new Headers() }), async () => {
      const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, {
        action: 'fetchImage', url: 'https://learning.oreilly.com/x.png',
      });
      assert(response && response.ok === false, 'HTTP failure must surface as ok:false');
    });
  });

  it('rejects disallowed, spoofed, and non-https URLs without fetching', async function() {
    let fetched = false;
    await withPatchedFetch(async () => { fetched = true; throw new Error('should not fetch'); }, async () => {
      for (const url of [
        'https://evil.example/x.jpg',
        'https://oreillystatic.com.evil.example/x.jpg',
        'http://learning.oreilly.com/x.jpg',
        undefined,
      ]) {
        const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, { action: 'fetchImage', url });
        assert(response && response.ok === false, `expected rejection for ${url}`);
      }
      assertEqual(fetched, false, 'handler must not fetch disallowed URLs');
    });
  });

  it('rejects responses that redirected outside the allowlist', async function() {
    const bytes = new Uint8Array([1, 2, 3]);
    await withPatchedFetch(async () => ({
      ok: true,
      url: 'https://evil.example/final.jpg',
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    }), async () => {
      const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, {
        action: 'fetchImage', url: 'https://learning.oreilly.com/library/cover/123/',
      });
      assert(response && response.ok === false,
        'a credentialed fetch that 302s off-allowlist must be rejected');
    });
  });

  // fetchCoverFallback dropped its local allowlist gate, so the SW handler is
  // now the single enforcement point for a library-proxy cover_url. The
  // isAllowedImageUrl unit tests cover the predicate; these prove the real
  // handler admits the proxy host at BOTH checkpoints (entry + post-redirect).
  it('accepts the declared library proxy host at the entry check', async function() {
    const bytes = new Uint8Array([4, 5, 6]);
    await withPatchedFetch(async () => ({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    }), async () => {
      const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, {
        action: 'fetchImage',
        url: 'https://learning-oreilly-com.ezproxy.spl.org/library/cover/123/',
      });
      assert(response && response.ok === true, `expected ok:true, got ${JSON.stringify(response)}`);
      assertEqual(response.data, btoa(String.fromCharCode(4, 5, 6)));
    });
  });

  it('accepts a response whose post-redirect URL stays on an allowlisted host', async function() {
    // The reject direction is covered above; this pins the accept direction so
    // a regression that over-tightens the post-redirect check (and silently
    // drops every proxy cover) turns a test red.
    const bytes = new Uint8Array([7, 8, 9]);
    await withPatchedFetch(async () => ({
      ok: true,
      url: 'https://learning-oreilly-com.ezproxy.spl.org/library/cover/123/final.jpg',
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    }), async () => {
      const response = await ChromeMock.dispatchTo(BACKGROUND_LISTENER, {
        action: 'fetchImage',
        url: 'https://learning-oreilly-com.ezproxy.spl.org/library/cover/123/',
      });
      assert(response && response.ok === true,
        'a credentialed fetch that stays on an allowlisted host must be accepted');
    });
  });
});
