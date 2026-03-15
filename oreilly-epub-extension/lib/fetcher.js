const Fetcher = {
  extractIsbn(url) {
    const match = url.match(/\/library\/(?:view|cover)\/[^/]+\/(\d{13})/);
    return match ? match[1] : null;
  },

  async _fetchWithRetry(url, { signal, maxRetries = 3 } = {}) {
    const delays = [1000, 3000, 9000];
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, { signal, credentials: 'include' });
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 10000;
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        if (response.status === 401) throw new Error('SESSION_EXPIRED');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
      } catch (err) {
        if (err.name === 'AbortError' || err.message === 'SESSION_EXPIRED') throw err;
        if (attempt === maxRetries) throw err;
        await new Promise(r => setTimeout(r, delays[attempt]));
        attempt++;
      }
    }
  },

  async throttledFetchAll(urls, { concurrency = 2, delayMs = 500, getContent, signal, onProgress } = {}) {
    const results = [];
    let completed = 0;
    for (let i = 0; i < urls.length; i += concurrency) {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const batch = urls.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (url) => {
          const response = await this._fetchWithRetry(url, { signal });
          const content = getContent ? await getContent(response) : response;
          completed++;
          if (onProgress) onProgress(completed, urls.length);
          return content;
        })
      );
      results.push(...batchResults);
      if (i + concurrency < urls.length) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
    return results;
  },

  extractImageUrls(xhtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
    const imgs = doc.querySelectorAll('img[src]');
    return Array.from(imgs).map(img => img.getAttribute('src'));
  },
};
