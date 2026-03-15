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
  it('extracts SVG image href', function() {
    const xhtml = '<html xmlns="http://www.w3.org/1999/xhtml"><body><svg xmlns="http://www.w3.org/2000/svg"><image href="diagram.svg"/></svg></body></html>';
    const urls = Fetcher.extractImageUrls(xhtml);
    assertEqual(urls.length, 1);
    assertEqual(urls[0], 'diagram.svg');
  });
  it('extracts object data for image types', function() {
    const xhtml = '<html xmlns="http://www.w3.org/1999/xhtml"><body><object data="chart.svg" type="image/svg+xml"></object></body></html>';
    const urls = Fetcher.extractImageUrls(xhtml);
    assertEqual(urls.length, 1);
    assertEqual(urls[0], 'chart.svg');
  });
  it('deduplicates URLs', function() {
    const xhtml = '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="a.png"/><img src="a.png"/></body></html>';
    assertEqual(Fetcher.extractImageUrls(xhtml).length, 1);
  });
});

describe('Fetcher.extractCssImageUrls', function() {
  it('extracts url() references from CSS', function() {
    const css = 'body { background: url("../images/bg.png"); } .icon { background-image: url(icon.svg); }';
    const urls = Fetcher.extractCssImageUrls(css);
    assertEqual(urls.length, 2);
    assertEqual(urls[0], '../images/bg.png');
    assertEqual(urls[1], 'icon.svg');
  });
  it('skips data URIs', function() {
    const css = '.x { background: url(data:image/png;base64,abc); }';
    assertEqual(Fetcher.extractCssImageUrls(css).length, 0);
  });
  it('deduplicates CSS image URLs', function() {
    const css = '.a { background: url(bg.png); } .b { background: url(bg.png); }';
    assertEqual(Fetcher.extractCssImageUrls(css).length, 1);
  });
});

describe('Fetcher.stripQueryAndHash', function() {
  it('strips query parameters', function() {
    assertEqual(Fetcher.stripQueryAndHash('image.png?v=123'), 'image.png');
  });
  it('strips hash fragments', function() {
    assertEqual(Fetcher.stripQueryAndHash('image.svg#layer1'), 'image.svg');
  });
  it('strips both query and hash', function() {
    assertEqual(Fetcher.stripQueryAndHash('img.png?w=100#x'), 'img.png');
  });
  it('returns unchanged path when no query or hash', function() {
    assertEqual(Fetcher.stripQueryAndHash('path/to/image.jpg'), 'path/to/image.jpg');
  });
});

describe('Fetcher.parseXhtml', function() {
  it('parses valid XHTML', function() {
    const doc = Fetcher.parseXhtml('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>test</p></body></html>');
    assertEqual(doc.querySelector('p').textContent, 'test');
  });
  it('falls back to text/html for malformed XHTML', function() {
    const doc = Fetcher.parseXhtml('<html><body><p>unclosed<br>tag</p></body></html>');
    assert(doc.querySelector('p') !== null, 'should parse with text/html fallback');
  });
});
