describe('Fetcher.extractIsbn', function() {
  it('extracts ISBN from standard book URL', function() {
    const isbn = Fetcher.extractIsbn('https://learning.oreilly.com/library/view/llm-engineers-handbook/9781836200079/Text/Chapter_04.xhtml');
    assertEqual(isbn, '9781836200079');
  });
  it('extracts ISBN from cover URL', function() {
    const isbn = Fetcher.extractIsbn('https://learning.oreilly.com/library/cover/9781836200079/');
    assertEqual(isbn, '9781836200079');
  });
  it('returns null for non-matching URL', function() {
    assertEqual(Fetcher.extractIsbn('https://learning.oreilly.com/playlists/something'), null);
  });
});

describe('Fetcher.throttledFetchAll', function() {
  it('fetches all URLs and returns results in order', async function() {
    const originalFetch = window.fetch;
    window.fetch = async (url) => ({ ok: true, text: async () => `content-${url}`, status: 200, headers: new Headers() });

    const results = await Fetcher.throttledFetchAll(['/a', '/b', '/c'], {
      concurrency: 2,
      delayMs: 10,
      getContent: async (res) => res.text(),
    });

    assertEqual(results.length, 3);
    assertEqual(results[0], 'content-/a');
    assertEqual(results[2], 'content-/c');
    window.fetch = originalFetch;
  });
});

describe('Fetcher.extractImageUrls', function() {
  it('extracts img src from XHTML', function() {
    const xhtml = '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/fig1.png"/><img src="../Images/fig2.jpg"/></body></html>';
    const urls = Fetcher.extractImageUrls(xhtml);
    assertEqual(urls.length, 2);
    assertEqual(urls[0], '../Images/fig1.png');
  });
  it('returns empty array when no images', function() {
    assertEqual(Fetcher.extractImageUrls('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>text</p></body></html>').length, 0);
  });
});
