# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) that converts O'Reilly Learning books to EPUB 3.0 format, optimized for e-ink readers. Runs entirely in the browser using the user's existing O'Reilly session — no backend server.

## Running Tests

Tests run in a browser (no Node.js test runner):
```bash
# Start a local server and open the test runner
python -m http.server 8765
# Then open: http://localhost:8765/oreilly-epub-extension/tests/test-runner.html
```

The test framework is a minimal custom implementation (`describe`/`it`/`assert`) in `test-runner.html`. Test files: `tests/*.test.js`.

## Loading the Extension

1. Open `chrome://extensions/` with Developer mode enabled
2. Click "Load unpacked" → select `oreilly-epub-extension/`
3. Navigate to any book page on `learning.oreilly.com`

## Architecture

### Three-Layer Communication Model

```
Popup (UI) ←→ Service Worker (relay/state) ←→ Content Script (all work)
```

- **Content script** (`content.js`) — the workhorse. Runs on `learning.oreilly.com`, does all fetching, parsing, and EPUB assembly. Same-origin context means session cookies are included automatically.
- **Service worker** (`background.js`) — thin relay. Forwards messages, updates badge, stores progress state so popup survives close/reopen cycles.
- **Popup** (`popup.html/js/css`) — pure UI. Queries service worker for state, displays it, sends commands.

### Library Modules (loaded as content scripts, not ES modules)

All expose global objects (`Fetcher`, `EpubBuilder`, `EinkOptimizer`) — no import/export. Load order in `manifest.json` matters.

- `lib/fetcher.js` — HTTP fetching with retry + progressive backoff. Handles both 403 and 429 as rate limits. ISBN extraction from URLs via regex.
- `lib/epub-builder.js` — Generates EPUB structural files (content.opf, toc.xhtml, toc.ncx, container.xml, cover.xhtml). Pure string generation, no side effects.
- `lib/eink-optimizer.js` — Rewrites chapter XHTML: injects e-ink CSS override, remaps image paths to `../Images/`, rewrites CSS links to `../Styles/`.
- `lib/jszip.min.js` — Third-party EPUB packaging.

### Key Implementation Details

- **Book metadata** comes from the search API (`/api/v2/search/?query={ISBN}&limit=1`), not DOM selectors. O'Reilly is a React SPA — DOM elements render asynchronously and are unreliable from content scripts.
- **Title fallback**: parses `document.title` (format: `"ChapterTitle | BookTitle"`) taking the last segment.
- **File manifest** is paginated — fetched in a loop following `filesData.next`.
- **Chapters fetched in batches of 2** with 1s delay between batches to avoid 403 rate limiting.
- **`mimetype` must be the first ZIP entry** with `{compression: 'STORE'}` per EPUB spec.
- **EPUB includes both EPUB 3 nav (`toc.xhtml`) and EPUB 2 NCX (`toc.ncx`)** for Boox reader compatibility.

## O'Reilly API Endpoints Used

- `GET /api/v2/search/?query={ISBN}&limit=1` — book metadata (title, authors)
- `GET /api/v2/epubs/urn:orm:book:{ISBN}/files/?limit=200` — file manifest (paginated)
- `GET /api/v2/epubs/urn:orm:book:{ISBN}/files/{path}` — individual file content

## Code Style

- Vanilla JavaScript, no build step, no frameworks
- All extension code wrapped in IIFEs (`(function() { 'use strict'; ... })()`)
- Library modules use global object pattern (e.g., `const Fetcher = { ... }`)
- Comments and code in English
