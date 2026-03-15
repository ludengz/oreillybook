(function() {
  'use strict';

  let abortController = null;
  let zipInstance = null;

  // Detect book on page load
  function detectBook() {
    const isbn = Fetcher.extractIsbn(window.location.href);
    if (!isbn) return;

    const titleEl = document.querySelector('h1, [data-testid="book-title"], .t-title');
    const title = titleEl ? titleEl.textContent.trim() : document.title;

    const authorEls = document.querySelectorAll('[data-testid="author-name"], .author-name, .t-authors a');
    const authors = authorEls.length > 0
      ? Array.from(authorEls).map(el => el.textContent.trim())
      : ['Unknown Author'];

    chrome.runtime.sendMessage({
      action: 'bookDetected',
      bookInfo: { isbn, title, authors },
    });
  }

  // Listen for commands
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startDownload') startDownload();
    else if (message.action === 'cancelDownload') cancelDownload();
    else if (message.action === 'getBookInfo') {
      sendResponse({ isbn: Fetcher.extractIsbn(window.location.href) });
      return true;
    }
  });

  function cancelDownload() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    zipInstance = null;
  }

  // startDownload and buildEpub are added in Task 9

  detectBook();
})();
