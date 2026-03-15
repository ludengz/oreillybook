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

  // Progress covers two phases: images (0-30%) and chapters (30-100%)
  function updateProgress(p) {
    const imgPct = p.totalImages > 0 ? (p.images || 0) / p.totalImages : 1;
    const chPct = p.totalChapters > 0 ? (p.chapter || 0) / p.totalChapters : 0;
    const pct = Math.round(imgPct * 30 + chPct * 70);

    document.getElementById('progress-fill').style.width = `${pct}%`;

    let label;
    if ((p.chapter || 0) === 0 && p.totalImages > 0) {
      label = `Images: ${p.images || 0}/${p.totalImages}`;
    } else {
      label = `Chapter ${p.chapter}/${p.totalChapters}`;
      if (p.totalImages > 0) label += ` · Images: ${p.images || 0}/${p.totalImages}`;
    }
    document.getElementById('progress-text').textContent = label;
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
