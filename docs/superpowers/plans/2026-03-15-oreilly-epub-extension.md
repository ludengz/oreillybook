# O'Reilly EPUB Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that one-click converts O'Reilly books to EPUB format optimized for e-ink readers (Boox).

**Architecture:** Content script on `learning.oreilly.com` handles fetching and EPUB assembly via JSZip. Lightweight service worker relays messages, updates badge, persists progress state. Popup is a minimal UI with 3 states (ready/downloading/not-on-oreilly).

**Tech Stack:** Vanilla JavaScript, Manifest V3, JSZip, Browser native DOMParser

**Spec:** `docs/superpowers/specs/2026-03-15-oreilly-epub-chrome-extension-design.md`

---

## File Structure

```
oreilly-epub-extension/
├── manifest.json                 # Manifest V3 config
├── background.js                 # Service worker: message relay, badge, state
├── content.js                    # Main orchestrator on O'Reilly pages
├── popup.html                    # Popup markup
├── popup.js                      # Popup logic
├── popup.css                     # Popup styles
├── lib/
│   ├── jszip.min.js              # Third-party: ZIP packaging
│   ├── epub-builder.js           # Generates EPUB structure files (opf, ncx, toc, container)
│   ├── fetcher.js                # Throttled fetching with retry, backoff, abort
│   └── eink-optimizer.js         # Transforms chapter XHTML for e-ink readability
├── styles/
│   └── eink-override.css         # CSS injected into EPUB for e-ink optimization
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── tests/
    ├── test-runner.html           # Browser-based async test runner
    ├── epub-builder.test.js
    ├── eink-optimizer.test.js
    └── fetcher.test.js
```

**Testing approach:** Browser-based async test runner (`tests/test-runner.html`). Each lib module exposes functions on a namespace object. Chrome extension APIs tested manually by loading unpacked extension.

---

## Chunk 1: Project Scaffolding & EPUB Builder

### Task 1: Project scaffolding

**Files:**
- Create: `oreilly-epub-extension/manifest.json`
- Create: `oreilly-epub-extension/icons/icon16.png`, `icon48.png`, `icon128.png`
- Create: all stub files

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p oreilly-epub-extension/{lib,styles,icons,tests}
```

- [ ] **Step 2: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "O'Reilly EPUB Exporter",
  "version": "1.0.0",
  "description": "One-click O'Reilly book to EPUB conversion for e-ink readers",
  "permissions": ["activeTab", "notifications"],
  "host_permissions": ["https://learning.oreilly.com/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [{
    "matches": [
      "https://learning.oreilly.com/library/view/*",
      "https://learning.oreilly.com/library/cover/*"
    ],
    "js": [
      "lib/jszip.min.js",
      "lib/epub-builder.js",
      "lib/fetcher.js",
      "lib/eink-optimizer.js",
      "content.js"
    ]
  }],
  "web_accessible_resources": [{
    "resources": ["styles/eink-override.css"],
    "matches": ["https://learning.oreilly.com/*"]
  }]
}
```

Note: `notifications` permission added for 401 session-expired alerts. `web_accessible_resources` declared so content script can fetch `eink-override.css` via `chrome.runtime.getURL`.

- [ ] **Step 3: Generate placeholder icons**

Create simple SVG-based PNG icons at 16x16, 48x48, 128x128. Red "O" on white background.

- [ ] **Step 4: Download JSZip**

```bash
curl -o oreilly-epub-extension/lib/jszip.min.js https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
```

- [ ] **Step 5: Create stub files**

Create empty stubs so extension loads without errors:
- `background.js` — `// Service worker stub`
- `content.js` — `// Content script stub`
- `popup.html` — minimal HTML with `<script src="popup.js">`
- `popup.js` — `// Popup stub`
- `popup.css` — empty
- `lib/epub-builder.js` — `const EpubBuilder = {};`
- `lib/fetcher.js` — `const Fetcher = {};`
- `lib/eink-optimizer.js` — `const EinkOptimizer = {};`

- [ ] **Step 6: Verify extension loads in Chrome**

1. Open `chrome://extensions`, enable Developer mode
2. Load unpacked → select `oreilly-epub-extension/`
3. Verify: extension appears, no console errors

- [ ] **Step 7: Commit**

```bash
git add oreilly-epub-extension/
git commit -m "feat: scaffold Chrome extension with manifest and stubs"
```

---

### Task 2: Browser-based test runner (async-capable)

**Files:**
- Create: `oreilly-epub-extension/tests/test-runner.html`
- Create: `oreilly-epub-extension/tests/epub-builder.test.js` (empty stub)
- Create: `oreilly-epub-extension/tests/eink-optimizer.test.js` (empty stub)
- Create: `oreilly-epub-extension/tests/fetcher.test.js` (empty stub)

- [ ] **Step 1: Create test-runner.html with async support**

```html
<!DOCTYPE html>
<html>
<head>
  <title>O'Reilly EPUB Extension Tests</title>
  <style>
    body { font-family: monospace; padding: 20px; }
    .pass { color: green; }
    .fail { color: red; font-weight: bold; }
    .suite { margin: 16px 0 4px; font-weight: bold; font-size: 14px; }
    .result { margin-left: 16px; }
    #summary { margin-top: 20px; font-size: 16px; padding: 10px; }
  </style>
</head>
<body>
  <h1>Test Runner</h1>
  <div id="output"></div>
  <div id="summary">Running...</div>

  <!-- Load modules under test -->
  <script src="../lib/epub-builder.js"></script>
  <script src="../lib/eink-optimizer.js"></script>
  <script src="../lib/fetcher.js"></script>

  <!-- Async test framework -->
  <script>
    const output = document.getElementById('output');
    const summaryEl = document.getElementById('summary');
    let passed = 0, failed = 0;
    const suites = [];
    let currentTests = null;

    function describe(name, fn) {
      currentTests = [];
      suites.push({ name, tests: currentTests });
      fn();
    }

    function it(name, fn) {
      currentTests.push({ name, fn });
    }

    function assert(condition, msg) {
      if (!condition) throw new Error(msg || 'Assertion failed');
    }

    function assertEqual(actual, expected, msg) {
      if (actual !== expected) {
        throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    }

    function assertContains(str, substr, msg) {
      if (typeof str !== 'string' || !str.includes(substr)) {
        throw new Error(msg || `Expected string to contain "${substr}"`);
      }
    }
  </script>

  <!-- Load test files -->
  <script src="epub-builder.test.js"></script>
  <script src="eink-optimizer.test.js"></script>
  <script src="fetcher.test.js"></script>

  <!-- Run all tests (async) -->
  <script>
    (async function runTests() {
      for (const suite of suites) {
        const div = document.createElement('div');
        div.className = 'suite';
        div.textContent = suite.name;
        output.appendChild(div);

        for (const test of suite.tests) {
          const res = document.createElement('div');
          res.className = 'result';
          try {
            await test.fn();
            res.className += ' pass';
            res.textContent = `✓ ${test.name}`;
            passed++;
          } catch (e) {
            res.className += ' fail';
            res.textContent = `✗ ${test.name}: ${e.message}`;
            failed++;
          }
          output.appendChild(res);
        }
      }
      summaryEl.textContent = `${passed} passed, ${failed} failed`;
      summaryEl.style.background = failed ? '#fee' : '#efe';
      summaryEl.style.color = failed ? 'red' : 'green';
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Create empty test file stubs**

Each file contains a single comment: `// Tests added in Task N`

- [ ] **Step 3: Verify test runner loads**

Open `tests/test-runner.html` in Chrome. Should show "0 passed, 0 failed" with green background.

- [ ] **Step 4: Commit**

```bash
git add oreilly-epub-extension/tests/
git commit -m "feat: add async browser-based test runner"
```

---

### Task 3: EPUB builder module

**Files:**
- Modify: `oreilly-epub-extension/lib/epub-builder.js`
- Modify: `oreilly-epub-extension/tests/epub-builder.test.js`

- [ ] **Step 1: Write failing tests for container.xml and utility functions**

In `tests/epub-builder.test.js`:

```javascript
describe('EpubBuilder._escapeXml', function() {
  it('escapes ampersands', function() {
    assertEqual(EpubBuilder._escapeXml('A & B'), 'A &amp; B');
  });
  it('escapes angle brackets and quotes', function() {
    assertEqual(EpubBuilder._escapeXml('<"test">'), '&lt;&quot;test&quot;&gt;');
  });
});

describe('EpubBuilder._mimeType', function() {
  it('returns correct type for jpg', function() {
    assertEqual(EpubBuilder._mimeType('photo.jpg'), 'image/jpeg');
  });
  it('returns correct type for png', function() {
    assertEqual(EpubBuilder._mimeType('fig.png'), 'image/png');
  });
  it('returns correct type for svg', function() {
    assertEqual(EpubBuilder._mimeType('diagram.svg'), 'image/svg+xml');
  });
  it('returns octet-stream for unknown extension', function() {
    assertEqual(EpubBuilder._mimeType('file.xyz'), 'application/octet-stream');
  });
});

describe('EpubBuilder.generateContainer', function() {
  it('generates valid container.xml pointing to content.opf', function() {
    const xml = EpubBuilder.generateContainer();
    assertContains(xml, '<?xml version="1.0"');
    assertContains(xml, 'urn:oasis:names:tc:opendocument:xmlns:container');
    assertContains(xml, 'OEBPS/content.opf');
    assertContains(xml, 'application/oebps-package+xml');
  });
});
```

- [ ] **Step 2: Run test runner — verify failure**

Expected: multiple failures — functions not defined

- [ ] **Step 3: Implement _escapeXml, _mimeType, _sanitizeId, generateContainer**

In `lib/epub-builder.js`:

```javascript
const EpubBuilder = {
  _escapeXml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _mimeType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const types = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
      css: 'text/css', xhtml: 'application/xhtml+xml',
      ncx: 'application/x-dtbncx+xml',
    };
    return types[ext] || 'application/octet-stream';
  },

  _sanitizeId(filename) {
    return filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  },

  generateContainer() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  },
};
```

- [ ] **Step 4: Run tests — verify pass**

Expected: 7 passed, 0 failed

- [ ] **Step 5: Write failing tests for content.opf generation**

Append to `tests/epub-builder.test.js`:

```javascript
describe('EpubBuilder.generateOpf', function() {
  const metadata = {
    title: 'Test Book',
    authors: ['Author One', 'Author Two'],
    isbn: '9781234567890',
    language: 'en',
    modified: '2024-01-01T00:00:00Z',
  };
  const chapters = [
    { filename: 'chapter_01.xhtml', title: 'Chapter 1' },
    { filename: 'chapter_02.xhtml', title: 'Chapter 2' },
  ];
  const images = ['cover.jpg', 'fig_01.png', 'diagram.svg'];
  const cssFiles = ['original.css', 'eink-override.css'];

  it('includes dc:identifier with ISBN', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, '<dc:identifier>urn:isbn:9781234567890</dc:identifier>');
  });
  it('includes dc:title', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, '<dc:title>Test Book</dc:title>');
  });
  it('includes dc:language', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, '<dc:language>en</dc:language>');
  });
  it('includes dcterms:modified', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, 'dcterms:modified');
  });
  it('includes all authors', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, '<dc:creator>Author One</dc:creator>');
    assertContains(opf, '<dc:creator>Author Two</dc:creator>');
  });
  it('lists chapters in manifest and spine', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, 'href="Text/chapter_01.xhtml"');
    assertContains(opf, 'idref="chapter_01"');
  });
  it('lists images with correct media types including SVG', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, 'href="Images/cover.jpg"');
    assertContains(opf, 'media-type="image/jpeg"');
    assertContains(opf, 'href="Images/diagram.svg"');
    assertContains(opf, 'media-type="image/svg+xml"');
  });
  it('lists CSS files in manifest', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, 'href="Styles/original.css"');
  });
  it('references nav and ncx', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles);
    assertContains(opf, 'properties="nav"');
    assertContains(opf, 'toc="ncx"');
  });
  it('marks cover image with properties="cover-image"', function() {
    const opf = EpubBuilder.generateOpf(metadata, chapters, images, cssFiles, 'cover.jpg');
    assertContains(opf, 'properties="cover-image"');
  });
});
```

- [ ] **Step 6: Run tests — verify failures**

Expected: 9 new failures

- [ ] **Step 7: Implement generateOpf**

Add to `EpubBuilder` object:

```javascript
  generateOpf(metadata, chapters, images, cssFiles, coverImageFilename) {
    const manifestItems = [];
    const spineItems = [];

    manifestItems.push('    <item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
    manifestItems.push('    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');

    cssFiles.forEach(f => {
      manifestItems.push(`    <item id="css-${this._sanitizeId(f)}" href="Styles/${f}" media-type="text/css"/>`);
    });

    chapters.forEach(ch => {
      const id = this._sanitizeId(ch.filename);
      manifestItems.push(`    <item id="${id}" href="Text/${ch.filename}" media-type="application/xhtml+xml"/>`);
      spineItems.push(`    <itemref idref="${id}"/>`);
    });

    images.forEach(img => {
      const props = (img === coverImageFilename) ? ' properties="cover-image"' : '';
      manifestItems.push(`    <item id="img-${this._sanitizeId(img)}" href="Images/${img}" media-type="${this._mimeType(img)}"${props}/>`);
    });

    const authors = metadata.authors.map(a => `    <dc:creator>${this._escapeXml(a)}</dc:creator>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:identifier id="bookid">urn:isbn:${metadata.isbn}</dc:identifier>
    <dc:title>${this._escapeXml(metadata.title)}</dc:title>
    <dc:language>${metadata.language}</dc:language>
${authors}
    <meta property="dcterms:modified">${metadata.modified}</meta>
  </metadata>
  <manifest>
${manifestItems.join('\n')}
  </manifest>
  <spine toc="ncx">
${spineItems.join('\n')}
  </spine>
</package>`;
  },
```

- [ ] **Step 8: Run tests — verify all pass**

Expected: 16 passed, 0 failed

- [ ] **Step 9: Write failing tests for toc.xhtml and toc.ncx**

```javascript
describe('EpubBuilder.generateTocXhtml', function() {
  const chapters = [
    { filename: 'chapter_01.xhtml', title: 'Introduction' },
    { filename: 'chapter_02.xhtml', title: 'Getting Started' },
  ];
  it('generates valid EPUB 3 nav document', function() {
    const toc = EpubBuilder.generateTocXhtml('Test Book', chapters);
    assertContains(toc, 'xmlns:epub="http://www.idpf.org/2007/ops"');
    assertContains(toc, 'epub:type="toc"');
  });
  it('links to all chapters', function() {
    const toc = EpubBuilder.generateTocXhtml('Test Book', chapters);
    assertContains(toc, 'href="Text/chapter_01.xhtml"');
    assertContains(toc, 'Introduction');
  });
});

describe('EpubBuilder.generateTocNcx', function() {
  const chapters = [
    { filename: 'chapter_01.xhtml', title: 'Introduction' },
    { filename: 'chapter_02.xhtml', title: 'Getting Started' },
  ];
  it('generates valid NCX with navPoints', function() {
    const ncx = EpubBuilder.generateTocNcx('9781234567890', 'Test Book', chapters);
    assertContains(ncx, 'xmlns="http://www.daisy.org/z3986/2005/ncx/"');
    assertContains(ncx, 'playOrder="1"');
    assertContains(ncx, 'Text/chapter_01.xhtml');
  });
});

describe('EpubBuilder.generateCoverXhtml', function() {
  it('generates cover page referencing cover image', function() {
    const cover = EpubBuilder.generateCoverXhtml('Test Book', 'cover.jpg');
    assertContains(cover, 'cover.jpg');
    assertContains(cover, 'Test Book');
  });
});
```

- [ ] **Step 10: Implement generateTocXhtml, generateTocNcx, and generateCoverXhtml**

```javascript
  generateTocXhtml(title, chapters) {
    const items = chapters.map(ch =>
      `        <li><a href="Text/${ch.filename}">${this._escapeXml(ch.title)}</a></li>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${this._escapeXml(title)}</title></head>
<body>
  <nav epub:type="toc">
    <h1>${this._escapeXml(title)}</h1>
    <ol>
${items}
    </ol>
  </nav>
</body>
</html>`;
  },

  generateTocNcx(isbn, title, chapters) {
    const navPoints = chapters.map((ch, i) =>
      `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${this._escapeXml(ch.title)}</text></navLabel>
      <content src="Text/${ch.filename}"/>
    </navPoint>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:isbn:${isbn}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${this._escapeXml(title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
  },

  generateCoverXhtml(title, coverImageFilename) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${this._escapeXml(title)}</title></head>
<body style="margin:0;padding:0;text-align:center;">
  <img src="../Images/${coverImageFilename}" alt="${this._escapeXml(title)}" style="max-width:100%;max-height:100%;"/>
</body>
</html>`;
  },
```

- [ ] **Step 11: Run tests — verify all pass**

Expected: 21 passed, 0 failed

- [ ] **Step 12: Commit**

```bash
git add oreilly-epub-extension/lib/epub-builder.js oreilly-epub-extension/tests/epub-builder.test.js
git commit -m "feat: implement EPUB builder with container, opf, toc, ncx, and cover generation"
```

---

## Chunk 2: Fetcher & E-Ink Optimizer

### Task 4: Fetcher module

**Files:**
- Modify: `oreilly-epub-extension/lib/fetcher.js`
- Modify: `oreilly-epub-extension/tests/fetcher.test.js`

- [ ] **Step 1: Write failing tests for ISBN extraction**

In `tests/fetcher.test.js`:

```javascript
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
```

- [ ] **Step 2: Run tests — verify failure**

- [ ] **Step 3: Implement extractIsbn**

```javascript
const Fetcher = {
  extractIsbn(url) {
    const match = url.match(/\/library\/(?:view|cover)\/[^/]+\/(\d{13})/);
    return match ? match[1] : null;
  },
};
```

- [ ] **Step 4: Run tests — verify pass**

- [ ] **Step 5: Write failing tests for throttledFetchAll**

```javascript
describe('Fetcher.throttledFetchAll', function() {
  it('fetches all URLs and returns results in order', async function() {
    const originalFetch = window.fetch;
    window.fetch = async (url) => ({ ok: true, text: async () => `content-${url}` });

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
```

- [ ] **Step 6: Implement _fetchWithRetry and throttledFetchAll**

```javascript
  async _fetchWithRetry(url, { signal, maxRetries = 3 } = {}) {
    const delays = [1000, 3000, 9000];
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const response = await fetch(url, { signal, credentials: 'include' });
        if (response.status === 429) {
          // 429 does NOT count as a retry attempt — pause and retry same attempt
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 10000;
          await new Promise(r => setTimeout(r, waitMs));
          continue; // Same attempt number
        }
        if (response.status === 401) throw new Error('SESSION_EXPIRED');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response;
      } catch (err) {
        if (err.name === 'AbortError' || err.message === 'SESSION_EXPIRED') throw err;
        if (attempt === maxRetries) throw err;
        await new Promise(r => setTimeout(r, delays[attempt]));
        attempt++; // Only increment on actual errors, not 429
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
```

- [ ] **Step 7: Run tests — verify pass**

- [ ] **Step 8: Write failing tests for extractImageUrls**

```javascript
describe('Fetcher.extractImageUrls', function() {
  it('extracts img src from XHTML', function() {
    const xhtml = '<html><body><img src="../Images/fig1.png"/><img src="../Images/fig2.jpg"/></body></html>';
    const urls = Fetcher.extractImageUrls(xhtml);
    assertEqual(urls.length, 2);
    assertEqual(urls[0], '../Images/fig1.png');
  });
  it('returns empty array when no images', function() {
    assertEqual(Fetcher.extractImageUrls('<html><body><p>text</p></body></html>').length, 0);
  });
});
```

- [ ] **Step 9: Implement extractImageUrls**

```javascript
  extractImageUrls(xhtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
    const imgs = doc.querySelectorAll('img[src]');
    return Array.from(imgs).map(img => img.getAttribute('src'));
  },
```

- [ ] **Step 10: Run tests — verify pass**

- [ ] **Step 11: Commit**

```bash
git add oreilly-epub-extension/lib/fetcher.js oreilly-epub-extension/tests/fetcher.test.js
git commit -m "feat: implement fetcher with throttling, retry, backoff, and image extraction"
```

---

### Task 5: E-ink optimizer module

**Files:**
- Modify: `oreilly-epub-extension/lib/eink-optimizer.js`
- Create: `oreilly-epub-extension/styles/eink-override.css`
- Modify: `oreilly-epub-extension/tests/eink-optimizer.test.js`

- [ ] **Step 1: Create eink-override.css**

```css
/* E-Ink Override — injected into EPUB for e-ink optimization */
body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.7;
  margin: 1.5em;
  color: #000;
}

pre, code {
  font-family: "Courier New", Courier, monospace;
  background: #f5f5f5;
  border: 1px solid #ccc;
  line-height: 1.5;
}

pre { padding: 0.8em; white-space: pre-wrap; word-wrap: break-word; }
code { padding: 0.1em 0.3em; }

/* Reset all syntax colors */
pre span, code span, [class*="hljs-"], [class*="token"] {
  color: #000 !important;
  background: transparent !important;
}

/* Keywords → bold */
.keyword, .hljs-keyword, .hljs-built_in, .hljs-type,
.token.keyword, .token.builtin { font-weight: bold !important; }

/* Strings → italic */
.string, .hljs-string, .hljs-regexp,
.token.string, .token.regex { font-style: italic !important; }

/* Comments → italic gray */
.comment, .hljs-comment, .hljs-meta,
.token.comment { font-style: italic !important; color: #666 !important; }

/* Functions → bold underline */
.function, .hljs-title, .hljs-function,
.token.function { font-weight: bold !important; text-decoration: underline !important; }
```

- [ ] **Step 2: Write failing tests**

In `tests/eink-optimizer.test.js`:

```javascript
describe('EinkOptimizer.injectOverrideCss', function() {
  it('adds eink-override.css link before </head>', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="styles.css"/></head><body></body></html>';
    const result = EinkOptimizer.injectOverrideCss(xhtml);
    assertContains(result, 'eink-override.css');
    assert(result.indexOf('styles.css') < result.indexOf('eink-override.css'),
      'eink-override must come after existing stylesheets');
  });
  it('handles XHTML with no existing stylesheets', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body></body></html>';
    assertContains(EinkOptimizer.injectOverrideCss(xhtml), 'eink-override.css');
  });
});

describe('EinkOptimizer.rewriteImagePaths', function() {
  it('rewrites relative paths to EPUB Images/ dir', function() {
    const xhtml = '<html><body><img src="../graphics/fig1.png"/></body></html>';
    const result = EinkOptimizer.rewriteImagePaths(xhtml, { '../graphics/fig1.png': 'fig1.png' });
    assertContains(result, 'src="../Images/fig1.png"');
  });
});

describe('EinkOptimizer.rewriteCssLinks', function() {
  it('rewrites CSS href to ../Styles/', function() {
    const xhtml = '<html><head><link rel="stylesheet" href="css/book.css"/></head><body></body></html>';
    const result = EinkOptimizer.rewriteCssLinks(xhtml);
    assertContains(result, 'href="../Styles/book.css"');
  });
});
```

- [ ] **Step 3: Run tests — verify failure**

- [ ] **Step 4: Implement EinkOptimizer**

```javascript
const EinkOptimizer = {
  injectOverrideCss(xhtml) {
    const link = '<link rel="stylesheet" type="text/css" href="../Styles/eink-override.css"/>';
    if (xhtml.includes('</head>')) {
      return xhtml.replace('</head>', `${link}\n</head>`);
    }
    return xhtml;
  },

  rewriteImagePaths(xhtml, imageMap) {
    let result = xhtml;
    for (const [original, newName] of Object.entries(imageMap)) {
      result = result.split(original).join(`../Images/${newName}`);
    }
    return result;
  },

  rewriteCssLinks(xhtml) {
    return xhtml.replace(
      /href="([^"]*\.css)"/g,
      (_, path) => `href="../Styles/${path.split('/').pop()}"`
    );
  },

  processChapter(xhtml, imageMap) {
    let result = this.rewriteCssLinks(xhtml);
    result = this.rewriteImagePaths(result, imageMap);
    result = this.injectOverrideCss(result);
    return result;
  },
};
```

- [ ] **Step 5: Run tests — verify pass**

- [ ] **Step 6: Commit**

```bash
git add oreilly-epub-extension/lib/eink-optimizer.js oreilly-epub-extension/styles/eink-override.css oreilly-epub-extension/tests/eink-optimizer.test.js
git commit -m "feat: implement e-ink optimizer with CSS injection and path rewriting"
```

---

## Chunk 3: Service Worker & Popup

### Task 6: Service worker (background.js)

**Files:**
- Modify: `oreilly-epub-extension/background.js`

The service worker relays messages between popup and content script, updates badge, and stores progress state. It also actively forwards progress messages to the popup via broadcast.

- [ ] **Step 1: Implement background.js**

```javascript
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
      // Update badge
      chrome.action.setBadgeText({
        text: `${message.chapter}/${message.totalChapters}`,
      });
      chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
      // Broadcast to popup (if open)
      chrome.runtime.sendMessage({
        action: 'progressUpdate',
        ...state.progress,
      }).catch(() => {}); // Ignore if popup not open
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
      // Show browser notification for session expiry
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
```

- [ ] **Step 2: Reload extension and verify no errors**

- [ ] **Step 3: Commit**

```bash
git add oreilly-epub-extension/background.js
git commit -m "feat: implement service worker with message relay, badge, and notifications"
```

---

### Task 7: Popup UI

**Files:**
- Modify: `oreilly-epub-extension/popup.html`
- Create: `oreilly-epub-extension/popup.css`
- Modify: `oreilly-epub-extension/popup.js`

- [ ] **Step 1: Create popup.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="header">
    <div class="logo">O</div>
    <span class="title">O'Reilly → EPUB</span>
  </div>

  <div id="state-not-oreilly" class="state" style="display:none;">
    <div class="notice">
      <div class="notice-icon">📖</div>
      <div class="notice-text">Navigate to an O'Reilly book page to get started</div>
    </div>
  </div>

  <div id="state-ready" class="state" style="display:none;">
    <div class="book-info">
      <div id="book-title" class="book-title"></div>
      <div id="book-authors" class="book-authors"></div>
    </div>
    <button id="btn-download" class="btn-primary">📥 Download EPUB</button>
  </div>

  <div id="state-downloading" class="state" style="display:none;">
    <div class="book-info">
      <div class="book-title-small">Downloading...</div>
      <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
      <div id="progress-text" class="progress-text"></div>
    </div>
    <button id="btn-cancel" class="btn-secondary">Cancel</button>
  </div>

  <div id="state-error" class="state" style="display:none;">
    <div class="notice error">
      <div class="notice-text" id="error-text"></div>
    </div>
    <button id="btn-retry" class="btn-primary">Retry</button>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create popup.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 300px; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; color: #333; }
.header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.logo { width: 28px; height: 28px; background: #d44; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 14px; }
.title { font-weight: 600; font-size: 14px; }
.state { padding: 0 16px 16px; }
.book-info { background: #f7f7f7; border-radius: 6px; padding: 10px; margin-bottom: 12px; }
.book-title { font-weight: 600; font-size: 13px; color: #222; margin-bottom: 2px; }
.book-title-small { font-weight: 600; font-size: 13px; color: #222; margin-bottom: 6px; }
.book-authors { font-size: 11px; color: #888; }
.btn-primary { width: 100%; background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 10px; font-weight: 600; font-size: 13px; cursor: pointer; }
.btn-primary:hover { background: #1d4ed8; }
.btn-secondary { width: 100%; background: #f3f4f6; color: #666; border: 1px solid #ddd; border-radius: 6px; padding: 10px; font-weight: 600; font-size: 13px; cursor: pointer; }
.btn-secondary:hover { background: #e5e7eb; }
.progress-bar { background: #e0e0e0; border-radius: 4px; height: 8px; margin-bottom: 4px; }
.progress-fill { background: #2563eb; border-radius: 4px; height: 8px; width: 0%; transition: width 0.3s ease; }
.progress-text { font-size: 11px; color: #888; }
.notice { background: #fef3c7; border-radius: 6px; padding: 12px; text-align: center; }
.notice.error { background: #fee; }
.notice-icon { font-size: 20px; margin-bottom: 4px; }
.notice-text { font-size: 13px; color: #92400e; }
.notice.error .notice-text { color: #dc2626; }
```

- [ ] **Step 3: Create popup.js**

```javascript
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

  // Get initial state from service worker
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

  // Listen for live progress broadcasts from service worker
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
```

- [ ] **Step 4: Reload extension, verify popup renders on non-O'Reilly page**

Expected: "Navigate to an O'Reilly book page" message

- [ ] **Step 5: Commit**

```bash
git add oreilly-epub-extension/popup.html oreilly-epub-extension/popup.css oreilly-epub-extension/popup.js
git commit -m "feat: implement popup UI with ready, downloading, and error states"
```

---

## Chunk 4: Content Script & Integration

### Task 8: Content script — book detection and message handling

**Files:**
- Modify: `oreilly-epub-extension/content.js`

- [ ] **Step 1: Implement book detection and message listener**

```javascript
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
    zipInstance = null; // Release accumulated data
  }

  // startDownload and buildEpub are added in Task 9

  detectBook();
})();
```

- [ ] **Step 2: Verify extension loads, detects book on O'Reilly page**

Navigate to O'Reilly book page, click extension icon, verify popup shows book info.

- [ ] **Step 3: Commit**

```bash
git add oreilly-epub-extension/content.js
git commit -m "feat: content script book detection and message handling"
```

---

### Task 9: Content script — download pipeline

**Files:**
- Modify: `oreilly-epub-extension/content.js`

Replace the last 3 lines of content.js (`// startDownload and buildEpub are added in Task 9`, `detectBook();`, and `})();`) with the full download pipeline below.

- [ ] **Step 1: Implement manifest fetching and file categorization**

Replace the placeholder comment and closing lines with:

```javascript
  async function startDownload() {
    const isbn = Fetcher.extractIsbn(window.location.href);
    if (!isbn) return;

    abortController = new AbortController();
    const signal = abortController.signal;
    zipInstance = new JSZip();
    const zip = zipInstance;

    try {
      // Fetch file manifest
      const filesRes = await fetch(`/api/v2/epubs/urn:orm:book:${isbn}/files`, {
        credentials: 'include', signal,
      });
      if (!filesRes.ok) throw new Error(`Manifest fetch failed: ${filesRes.status}`);
      const filesData = await filesRes.json();

      // Categorize files
      const files = filesData.results || filesData;
      const chapterFiles = [];
      const cssFiles = [];
      const imageFiles = [];

      for (const file of files) {
        const path = typeof file === 'string' ? file : (file.url || file.full_path || '');
        if (path.match(/\.xhtml$/i)) chapterFiles.push(path);
        else if (path.match(/\.css$/i)) cssFiles.push(path);
        else if (path.match(/\.(png|jpe?g|gif|svg|webp)$/i)) imageFiles.push(path);
      }

      // Large book warning
      if (chapterFiles.length > 100) {
        console.warn(`Large book detected: ${chapterFiles.length} chapters. This may take a while.`);
      }

      await buildEpub(zip, isbn, chapterFiles, cssFiles, signal);

    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Download cancelled');
        zipInstance = null;
        return;
      }
      console.error('Download failed:', err);
      chrome.runtime.sendMessage({
        action: 'downloadError',
        error: err.message === 'SESSION_EXPIRED'
          ? 'Session expired. Please log in to O\'Reilly and try again.'
          : err.message,
      });
      zipInstance = null;
    }
  }
```

- [ ] **Step 2: Implement EPUB assembly function**

```javascript
  async function buildEpub(zip, isbn, chapterFiles, cssFiles, signal) {
    const totalChapters = chapterFiles.length;

    // mimetype must be first entry, uncompressed
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', EpubBuilder.generateContainer());

    // Fetch and bundle eink-override.css
    const einkRes = await fetch(chrome.runtime.getURL('styles/eink-override.css'));
    zip.file('OEBPS/Styles/eink-override.css', await einkRes.text());

    // Fetch original CSS files (with retry)
    const cssFilenames = [];
    for (const cssPath of cssFiles) {
      try {
        const res = await Fetcher._fetchWithRetry(cssPath, { signal });
        const filename = cssPath.split('/').pop();
        cssFilenames.push(filename);
        zip.file(`OEBPS/Styles/${filename}`, await res.text());
      } catch (e) { console.warn(`CSS fetch failed: ${cssPath}`, e); }
    }

    // Fetch chapters in batches of 5
    const chapters = [];
    const imageMap = {};
    let completedChapters = 0;

    for (let i = 0; i < chapterFiles.length; i += 5) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      const batch = chapterFiles.slice(i, i + 5);
      // Fetch each chapter individually with error handling per chapter
      const batchContents = await Promise.all(
        batch.map(async (url) => {
          try {
            const res = await Fetcher._fetchWithRetry(url, { signal });
            return await res.text();
          } catch (err) {
            if (err.name === 'AbortError' || err.message === 'SESSION_EXPIRED') throw err;
            console.warn(`Chapter fetch failed: ${url}`, err);
            return null; // Will be handled as placeholder
          }
        })
      );

      for (let j = 0; j < batch.length; j++) {
        const chapterPath = batch[j];
        const chapterNum = i + j + 1;
        const filename = `chapter_${String(chapterNum).padStart(2, '0')}.xhtml`;

        // Handle chapter fetch failure — insert placeholder if needed
        let xhtml = batchContents[j];
        if (xhtml === null) {
          // Insert placeholder page for failed chapter
          const placeholder = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter ${chapterNum}</title></head>
<body><p><em>Chapter ${chapterNum} could not be downloaded.</em></p></body>
</html>`;
          zip.file(`OEBPS/Text/${filename}`, placeholder);
          chapters.push({ filename, title: `Chapter ${chapterNum} (unavailable)` });
          completedChapters++;
          continue;
        }

        // Extract title
        const parser = new DOMParser();
        const doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
        const h1 = doc.querySelector('h1');
        const titleEl = doc.querySelector('title');
        const chapterTitle = h1 ? h1.textContent.trim()
          : titleEl ? titleEl.textContent.trim()
          : `Chapter ${chapterNum}`;

        // Download images from this chapter (with retry)
        const imgUrls = Fetcher.extractImageUrls(xhtml);
        const chapterImageMap = {};
        for (const imgSrc of imgUrls) {
          const absoluteUrl = new URL(imgSrc, chapterPath).href;
          const imgFilename = imgSrc.split('/').pop();
          if (!imageMap[imgSrc]) {
            try {
              const imgRes = await Fetcher._fetchWithRetry(absoluteUrl, { signal });
              zip.file(`OEBPS/Images/${imgFilename}`, await imgRes.arrayBuffer());
              imageMap[imgSrc] = imgFilename;
            } catch (e) { console.warn(`Image fetch failed: ${absoluteUrl}`, e); }
          }
          chapterImageMap[imgSrc] = imageMap[imgSrc] || imgFilename;
        }

        // Process for e-ink and add to zip
        xhtml = EinkOptimizer.processChapter(xhtml, chapterImageMap);
        zip.file(`OEBPS/Text/${filename}`, xhtml);
        chapters.push({ filename, title: chapterTitle });

        completedChapters++;
        chrome.runtime.sendMessage({
          action: 'progress',
          chapter: completedChapters,
          totalChapters,
          images: Object.keys(imageMap).length,
          totalImages: 0, // Not known upfront
        });
      }
    }

    // Get metadata
    const pageTitleEl = document.querySelector('h1, [data-testid="book-title"]');
    const bookTitle = pageTitleEl ? pageTitleEl.textContent.trim() : document.title;
    const authorEls = document.querySelectorAll('[data-testid="author-name"], .author-name');
    const authors = authorEls.length > 0
      ? Array.from(authorEls).map(el => el.textContent.trim())
      : ['Unknown Author'];

    const metadata = {
      title: bookTitle, authors, isbn,
      language: 'en',
      modified: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    const allCssFiles = [...cssFilenames, 'eink-override.css'];
    const allImageFiles = [...new Set(Object.values(imageMap))];

    // Try to add cover
    const coverImage = allImageFiles.find(f => /cover/i.test(f));
    if (coverImage) {
      zip.file('OEBPS/Text/cover.xhtml', EpubBuilder.generateCoverXhtml(bookTitle, coverImage));
      chapters.unshift({ filename: 'cover.xhtml', title: 'Cover' });
    }

    // Generate structural EPUB files (pass coverImage for properties="cover-image")
    zip.file('OEBPS/content.opf', EpubBuilder.generateOpf(metadata, chapters, allImageFiles, allCssFiles, coverImage || null));
    zip.file('OEBPS/toc.xhtml', EpubBuilder.generateTocXhtml(metadata.title, chapters));
    zip.file('OEBPS/toc.ncx', EpubBuilder.generateTocNcx(isbn, metadata.title, chapters));

    // Generate and download EPUB
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
    const url = URL.createObjectURL(blob);
    const sanitizedTitle = bookTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizedTitle}.epub`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    zipInstance = null;
    chrome.runtime.sendMessage({ action: 'downloadComplete' });
  }

})();
```

- [ ] **Step 3: Reload extension, verify no syntax errors**

- [ ] **Step 4: Commit**

```bash
git add oreilly-epub-extension/content.js
git commit -m "feat: implement full download pipeline with EPUB assembly"
```

---

### Task 10: End-to-end testing & polish

**Files:** No new files

- [ ] **Step 1: Run all unit tests**

Open `tests/test-runner.html`. Verify all pass.

- [ ] **Step 2: Test book detection**

1. Log into O'Reilly
2. Navigate to a book page
3. Click extension icon → verify book info shown

- [ ] **Step 3: Test full download**

1. Click "Download EPUB"
2. Verify badge updates with progress
3. Verify popup shows progress bar
4. Verify `.epub` file downloads

- [ ] **Step 4: Verify EPUB on Boox**

1. Transfer to Boox
2. Verify: TOC works, chapter order correct, code blocks readable, images display

- [ ] **Step 5: Test cancel**

Start download → click Cancel → verify download stops, badge clears

- [ ] **Step 6: Test non-O'Reilly page**

Verify popup shows "Navigate to O'Reilly" message

- [ ] **Step 7: Fix any issues and commit**

```bash
git add -u
git commit -m "fix: address issues from integration testing"
```

---

### Task 11: Final cleanup

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create .gitignore**

```
.superpowers/
node_modules/
*.zip
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```
