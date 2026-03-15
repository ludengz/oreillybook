# O'Reilly EPUB Chrome Extension — Design Spec

## Overview

A Chrome extension that converts O'Reilly Learning books into EPUB format with a single click, optimized for e-ink readers (Boox). The extension runs entirely in the browser, leveraging the user's existing O'Reilly session for authentication.

## Goals

- One-click conversion of entire O'Reilly books to EPUB 3.0
- Preserve all styling while optimizing code blocks for e-ink displays
- Retain all images in original quality
- Minimal UI — just works

## Non-Goals

- Selective chapter download (may add later)
- Support for video/interactive content
- Offline reading within the extension itself
- DRM circumvention (relies on user's legitimate subscription session)

## Architecture

### Approach: Content Script + Lightweight Service Worker

The extension uses a content script on `learning.oreilly.com` for the heavy lifting (fetching, parsing, EPUB assembly) and a minimal service worker for messaging relay, badge updates, and progress state persistence. No backend server required.

```
┌──────────────────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3)                          │
│                                                          │
│  ┌──────────┐    ┌─────────────────┐    ┌─────────────┐ │
│  │ Popup    │◄──▶│ Service Worker  │◄──▶│ Content     │ │
│  │ (minimal)│    │ (lightweight)   │    │ Script      │ │
│  │ UI only  │    │ - msg relay     │    │ - fetch     │ │
│  └──────────┘    │ - badge updates │    │ - parse     │ │
│                  │ - state store   │    │ - build EPUB│ │
│                  └─────────────────┘    │ - download  │ │
│                                         └─────────────┘ │
│                                                          │
│  Dependencies: JSZip (packaging)                         │
│  Auth: Browser cookies (automatic via same-origin fetch) │
└──────────────────────────────────────────────────────────┘
```

### Role Separation

- **Content script** — runs on `learning.oreilly.com`. Does all fetching (same-origin, cookies auto-included), DOM parsing, EPUB assembly with JSZip, and triggers the file download. This is where the work happens.
- **Service worker** — minimal relay. Receives progress messages from content script, updates extension badge, stores progress state so popup can recover it on reopen. No heavy logic.
- **Popup** — pure UI. Queries service worker for current state on open, displays it, sends start/cancel commands through service worker to content script.

### Why This Approach

- Content script runs in the page's origin context — same-origin fetches to `learning.oreilly.com/api/...` carry session cookies automatically without any CORS issues
- Service worker is minimal (message relay + badge) so its 5-minute idle timeout is irrelevant — content script does the actual work independently
- Popup can close and reopen without losing progress — state lives in service worker
- No backend server or Node.js runtime needed

### Alternatives Considered

1. **Pure Content Script (no SW)** — Rejected: cannot update badge or persist progress state across popup open/close cycles.
2. **Extension + Local Node.js Service** — Rejected: violates the "one-click" simplicity goal, requires extra installation.

## Content Discovery & Fetching

### API Domain

All API endpoints are on the same domain as the book content: `learning.oreilly.com`. This means content script fetches are same-origin and automatically include session cookies. No additional `host_permissions` beyond `https://learning.oreilly.com/*` are needed.

### Book Metadata

1. Extract ISBN from current page URL: `/library/view/{title}/{ISBN}/...`
2. Call `GET /api/v2/epubs/urn:orm:book:{ISBN}/files` to get complete file manifest
3. Categorize returned files: XHTML chapters, CSS stylesheets, image assets

### Chapter Fetching Strategy

- Fetch chapters sequentially by TOC order with throttling (2 concurrent requests, 500ms intervals between batches)
- Use `AbortController` for each fetch — enables cancellation (see Cancel Mechanism below)
- After each chapter fetch, parse DOM and queue referenced images for download

### Image Handling

- Extract `<img src="...">` relative paths from XHTML
- Download as blobs, preserving original format (PNG/JPG/SVG)
- Rewrite image references in EPUB to point to `Images/` directory

### Progress Feedback

- Content script sends progress updates to service worker via `chrome.runtime.sendMessage`
- Service worker updates extension badge (e.g., `3/25` for chapters completed)
- Badge shows `✓` on completion, `!` on error
- Service worker stores latest progress in memory for popup to query on open

### Error Handling

- **Retry logic:** Auto-retry failed chapter fetches with exponential backoff (3 retries: 1s, 3s, 9s delays)
- **429 Rate Limit:** On 429 response, read `Retry-After` header; if absent, use exponential backoff starting at 10s. Pause all fetches until the backoff period expires, then resume.
- **Permanent failure:** Skip chapter after all retries exhausted, insert placeholder page in EPUB noting the missing chapter
- **401 Session expired:** Abort all fetches, show browser notification prompting user to re-login on O'Reilly, reset extension state

### Cancel Mechanism

- Content script maintains an `AbortController` for the overall download session
- "Cancel" action calls `controller.abort()`, which cancels all in-flight fetch requests
- On abort, content script clears all accumulated data (chapter buffers, image blobs) and notifies service worker to reset badge and state

### Memory Management for Large Books

Some O'Reilly books exceed 1000 pages with hundreds of images. To manage memory:

- Process chapters in batches of 5: fetch → parse → add to JSZip instance → release raw data
- Images are added to JSZip immediately after download, then the blob reference is released
- JSZip holds compressed data incrementally, keeping peak memory lower than holding all raw content
- For extremely large books (>100 chapters), show an estimated file size warning before starting

## EPUB Generation

### Package Structure

```
book.epub (ZIP)
├── mimetype                          # "application/epub+zip" (stored, not compressed)
├── META-INF/
│   └── container.xml                 # Points to content.opf
├── OEBPS/
│   ├── content.opf                   # Package document (metadata + manifest + spine)
│   ├── toc.xhtml                     # EPUB 3 navigation document
│   ├── toc.ncx                       # EPUB 2 backward-compatible navigation (Boox compat)
│   ├── Styles/
│   │   ├── original.css              # O'Reilly original styles
│   │   └── eink-override.css         # E-ink optimized overrides
│   ├── Text/
│   │   ├── cover.xhtml
│   │   ├── chapter_01.xhtml
│   │   ├── chapter_02.xhtml
│   │   └── ...
│   └── Images/
│       ├── cover.jpg
│       ├── fig_01_01.png
│       └── ...
```

### Key File Generation

- **content.opf** — Auto-generated from API metadata: title, author(s), ISBN, language, publication date. Manifest lists all resources; spine orders chapters for reading. Must include required EPUB 3 metadata: `dc:identifier`, `dc:title`, `dc:language`, and `meta[property="dcterms:modified"]`.
- **toc.xhtml + toc.ncx** — Dual-format navigation generated from chapter `<h1>`/`<h2>` headings. NCX included for EPUB 2 reader compatibility (Boox).
- **eink-override.css** — Injected after original styles to override visual presentation for e-ink.

### JSZip Packaging Details

- **mimetype ordering:** JSZip does not guarantee file insertion order. To ensure `mimetype` is the first ZIP entry (EPUB spec requirement), add it first with `{compression: 'STORE'}` before adding any other files. JSZip respects insertion order when no sorting is applied.
- All other files use DEFLATE compression
- Final output via `generateAsync({type: 'blob'})` triggering browser download

## E-Ink Code Block Optimization

### Problem

E-ink screens render only 16 levels of grayscale. CSS color-based syntax highlighting becomes indistinguishable (blue and green keywords look identical in grayscale).

### Solution: `eink-override.css`

Replace color-based highlighting with typographic differentiation:

| Element | Original (Color) | E-Ink Optimized |
|---------|-------------------|-----------------|
| Keywords | Blue/purple text | **Bold** black |
| Strings | Green/red text | *Italic* black |
| Comments | Gray text | *Italic* medium gray (#666) |
| Function names | Various colors | **Bold + underline** |
| All other tokens | Various colors | Plain black |

### CSS Class Discovery

O'Reilly's syntax highlighting classes need to be confirmed during implementation. The approach:

1. **Pre-implementation research:** Inspect several O'Reilly book pages to catalog actual CSS class names used for code highlighting (may be highlight.js classes like `hljs-keyword`, or O'Reilly custom classes)
2. **Broad selectors:** The override CSS uses both specific class selectors (`.hljs-keyword`, `.token.keyword`) AND a catch-all rule that forces all `<code> span` elements to `color: #000` as a fallback
3. **Attribute-based fallback:** If classes are obfuscated, fall back to targeting `<pre>` and `<code>` elements structurally rather than by class name

### Additional E-Ink Optimizations

- Body font forced to serif (more readable on e-ink)
- Line height set to 1.6-1.8
- Increased page margins to avoid text hugging edges
- Code blocks: monospace font, light gray background (#f5f5f5), 1px solid border

### Implementation

1. Parse `<pre>` / `<code>` elements in each chapter XHTML
2. Detect syntax highlighting CSS classes (cataloged during pre-research)
3. Append `eink-override.css` reference in each XHTML `<head>` (after original styles for CSS specificity override)
4. No HTML structure modifications — purely CSS-driven

## Chrome Extension Structure

### File Layout

```
oreilly-epub-extension/
├── manifest.json
├── popup.html / popup.js         # Popup UI and state management
├── background.js                 # Service worker: msg relay, badge, state
├── content.js                    # Injected on O'Reilly, handles fetching
├── lib/
│   ├── jszip.min.js              # EPUB packaging
│   ├── epub-builder.js           # EPUB structure generation
│   ├── fetcher.js                # Chapter/image fetching with throttling
│   └── eink-optimizer.js         # Code block e-ink optimization
├── styles/
│   └── eink-override.css         # Injected into EPUB
└── icons/
    ├── 16.png
    ├── 48.png
    └── 128.png
```

### Manifest V3

```json
{
  "manifest_version": 3,
  "name": "O'Reilly EPUB Exporter",
  "version": "1.0.0",
  "description": "One-click O'Reilly book to EPUB conversion for e-ink readers",
  "permissions": ["activeTab"],
  "host_permissions": ["https://learning.oreilly.com/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/16.png",
      "48": "icons/48.png",
      "128": "icons/128.png"
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
  }]
}
```

### Popup States

1. **Ready** — Detected O'Reilly book page. Shows: book title, author(s), chapter count. Action: "Download EPUB" button.
2. **Downloading** — Progress bar with chapter/image counts. Action: "Cancel" button.
3. **Not on O'Reilly** — Friendly message prompting user to navigate to an O'Reilly book page.

### Communication Flow

1. **Popup → Service Worker:** `{action: "getState"}` on open → receives current state (idle/downloading/complete) and book info
2. **Popup → Service Worker → Content Script:** `{action: "startDownload"}` or `{action: "cancelDownload"}` relayed via `chrome.tabs.sendMessage`
3. **Content Script → Service Worker:** `{action: "progress", chapter: 12, total: 25, images: {done: 34, total: 67}}` — SW updates badge and stores state
4. **Content Script → Browser:** triggers file download via `URL.createObjectURL` + click on hidden `<a download>` element

This model ensures the popup can close and reopen at any time without losing progress information.

## EPUB Validation

Rather than bundling a full EPUB validator, the extension ensures compliance through construction:

- **Required metadata:** `content.opf` always includes `dc:identifier` (ISBN), `dc:title`, `dc:language`, and `dcterms:modified`
- **XML namespaces:** All generated XHTML files include proper EPUB 3 namespace declarations
- **mimetype file:** First ZIP entry, uncompressed, exact content `application/epub+zip` with no trailing newline
- **container.xml:** Standard boilerplate pointing to `OEBPS/content.opf`
- **Navigation:** Both `toc.xhtml` (EPUB 3 nav) and `toc.ncx` (EPUB 2 fallback) are generated
- **Manual validation:** Users can optionally validate output with EPUBCheck (external tool, not bundled)

## Technology Stack

- **Language:** Vanilla JavaScript (no build step needed)
- **EPUB Packaging:** JSZip
- **DOM Parsing:** Browser native DOMParser
- **Styling:** CSS only (eink-override.css)
- **No frameworks** — keeps the extension lightweight and simple

## Output

- EPUB file named `{book-title}.epub` (sanitized filename: spaces → hyphens, special chars removed)
- Automatically triggers browser download dialog
- File is a valid EPUB 3.0 with EPUB 2 NCX fallback for maximum reader compatibility
