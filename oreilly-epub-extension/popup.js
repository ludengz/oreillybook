(function() {
  'use strict';

  const stateEls = {
    notOreilly: document.getElementById('state-not-oreilly'),
    ready: document.getElementById('state-ready'),
    downloading: document.getElementById('state-downloading'),
    error: document.getElementById('state-error'),
  };

  function showState(name) {
    Object.values(stateEls).forEach(el => el.style.display = 'none');
    if (stateEls[name]) stateEls[name].style.display = 'block';
  }

  function updateProgress(p) {
    const pct = p.totalChapters > 0 ? Math.round((p.chapter / p.totalChapters) * 100) : 0;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-text').textContent =
      `Chapter ${p.chapter}/${p.totalChapters} · Images: ${p.images || 0}/${p.totalImages || 0}`;
  }

  chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
    if (!state || !state.bookInfo) {
      showState('notOreilly');
      return;
    }
    if (state.status === 'downloading' && state.progress) {
      showState('downloading');
      updateProgress(state.progress);
    } else if (state.status === 'error') {
      showState('error');
      document.getElementById('error-text').textContent = state.error || 'Unknown error';
    } else {
      showState('ready');
      document.getElementById('book-title').textContent = state.bookInfo.title;
      document.getElementById('book-authors').textContent = state.bookInfo.authors.join(', ');
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'progressUpdate') {
      showState('downloading');
      updateProgress(message);
    } else if (message.action === 'downloadComplete') {
      showState('ready');
    } else if (message.action === 'downloadError') {
      showState('error');
      document.getElementById('error-text').textContent = message.error;
    }
  });

  document.getElementById('btn-download').addEventListener('click', () => {
    showState('downloading');
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-text').textContent = 'Starting...';
    chrome.runtime.sendMessage({ action: 'startDownload' });
  });

  document.getElementById('btn-cancel').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'cancelDownload' });
    showState('ready');
  });

  document.getElementById('btn-retry').addEventListener('click', () => {
    showState('downloading');
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-text').textContent = 'Retrying...';
    chrome.runtime.sendMessage({ action: 'startDownload' });
  });
})();
