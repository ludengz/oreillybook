(function() {
  'use strict';

  let abortController = null;
  let zipInstance = null;

  // Extract book title from document.title which has format "ChapterTitle | BookTitle"
  function extractBookTitle() {
    const parts = document.title.split(' | ');
    return parts.length > 1 ? parts[parts.length - 1].trim() : document.title.trim();
  }

  // Fetch book metadata (title, authors) from O'Reilly API
  async function fetchBookMetadata(isbn) {
    try {
      const res = await fetch(`/api/v2/search/?query=${isbn}&limit=1`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        const book = data.results?.[0];
        if (book) {
          return {
            title: book.title || extractBookTitle(),
            authors: book.authors?.length ? book.authors : null,
          };
        }
      }
    } catch (e) { console.warn('Metadata fetch failed:', e); }
    return { title: extractBookTitle(), authors: null };
  }

  // Detect book on page load
  async function detectBook() {
    const isbn = Fetcher.extractIsbn(window.location.href);
    if (!isbn) return;

    const meta = await fetchBookMetadata(isbn);
    const authors = meta.authors || ['Unknown Author'];

    chrome.runtime.sendMessage({
      action: 'bookDetected',
      bookInfo: { isbn, title: meta.title, authors },
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

  async function startDownload() {
    if (abortController) return; // Already downloading
    const isbn = Fetcher.extractIsbn(window.location.href);
    if (!isbn) return;

    abortController = new AbortController();
    const signal = abortController.signal;
    zipInstance = new JSZip();
    const zip = zipInstance;

    try {
      // Fetch all pages of the file manifest (API is paginated, ~20 per page)
      const allFiles = [];
      let nextUrl = `/api/v2/epubs/urn:orm:book:${isbn}/files/?limit=200`;
      while (nextUrl) {
        const filesRes = await fetch(nextUrl, { credentials: 'include', signal });
        if (!filesRes.ok) throw new Error(`Manifest fetch failed: ${filesRes.status}`);
        const filesData = await filesRes.json();
        const results = filesData.results || filesData;
        allFiles.push(...(Array.isArray(results) ? results : []));
        // Follow pagination; convert absolute URL to relative path
        if (filesData.next) {
          const u = new URL(filesData.next);
          nextUrl = u.pathname + u.search;
        } else {
          nextUrl = null;
        }
      }
      console.log(`Manifest loaded: ${allFiles.length} files total`);

      const chapterFiles = [];
      const cssFiles = [];
      const imageFiles = [];

      for (const file of allFiles) {
        const path = file.full_path || file.filename || '';
        const kind = file.kind || '';
        const mediaType = file.media_type || '';
        const contentUrl = `/api/v2/epubs/urn:orm:book:${isbn}/files/${path}`;

        if (kind === 'chapter' || mediaType === 'text/html' || mediaType === 'application/xhtml+xml') {
          chapterFiles.push({ path, url: contentUrl });
        } else if (mediaType === 'text/css' || path.match(/\.css$/i)) {
          cssFiles.push({ path, url: contentUrl });
        } else if (mediaType.startsWith('image/') || path.match(/\.(png|jpe?g|gif|svg|webp)$/i)) {
          imageFiles.push({ path, url: contentUrl });
        }
      }

      console.log(`Found: ${chapterFiles.length} chapters, ${cssFiles.length} CSS, ${imageFiles.length} images`);
      if (chapterFiles.length > 100) {
        console.warn(`Large book detected: ${chapterFiles.length} chapters. This may take a while.`);
      }

      await buildEpub(zip, isbn, chapterFiles, cssFiles, imageFiles, signal);

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

  async function buildEpub(zip, isbn, chapterFiles, cssFiles, imageFiles, signal) {
    const totalChapters = chapterFiles.length;
    const totalImages = imageFiles.length;

    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', EpubBuilder.generateContainer());

    const einkRes = await fetch(chrome.runtime.getURL('styles/eink-override.css'));
    zip.file('OEBPS/Styles/eink-override.css', await einkRes.text());

    const cssFilenames = [];
    for (const cssFile of cssFiles) {
      try {
        const res = await Fetcher._fetchWithRetry(cssFile.url, { signal });
        const filename = cssFile.path.split('/').pop();
        cssFilenames.push(filename);
        zip.file(`OEBPS/Styles/${filename}`, await res.text());
      } catch (e) { console.warn(`CSS fetch failed: ${cssFile.path}`, e); }
    }

    const chapters = [];
    const imageMap = {};
    let completedChapters = 0;

    for (let i = 0; i < chapterFiles.length; i += 2) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

      // Throttle: wait 1s between batches to avoid 403 rate limiting
      if (i > 0) await new Promise(r => setTimeout(r, 1000));

      const batch = chapterFiles.slice(i, i + 2);
      const batchContents = await Promise.all(
        batch.map(async (chapterFile) => {
          try {
            const res = await Fetcher._fetchWithRetry(chapterFile.url, { signal });
            return await res.text();
          } catch (err) {
            if (err.name === 'AbortError' || err.message === 'SESSION_EXPIRED') throw err;
            console.warn(`Chapter fetch failed: ${chapterFile.path}`, err);
            return null;
          }
        })
      );

      for (let j = 0; j < batch.length; j++) {
        const chapterPath = batch[j].url;
        const chapterNum = i + j + 1;
        const filename = `chapter_${String(chapterNum).padStart(2, '0')}.xhtml`;

        let xhtml = batchContents[j];
        if (xhtml === null) {
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

        const parser = new DOMParser();
        const doc = parser.parseFromString(xhtml, 'application/xhtml+xml');
        const h1 = doc.querySelector('h1');
        const titleEl = doc.querySelector('title');
        const chapterTitle = h1 ? h1.textContent.trim()
          : titleEl ? titleEl.textContent.trim()
          : `Chapter ${chapterNum}`;

        const imgUrls = Fetcher.extractImageUrls(xhtml);
        const chapterImageMap = {};
        for (const imgSrc of imgUrls) {
          const absoluteUrl = new URL(imgSrc, window.location.origin + chapterPath).href;
          const imgFilename = `ch${String(chapterNum).padStart(2, '0')}_${imgSrc.split('/').pop()}`;
          if (!imageMap[imgSrc]) {
            try {
              const imgRes = await Fetcher._fetchWithRetry(absoluteUrl, { signal });
              zip.file(`OEBPS/Images/${imgFilename}`, await imgRes.arrayBuffer());
              imageMap[imgSrc] = imgFilename;
            } catch (e) { console.warn(`Image fetch failed: ${absoluteUrl}`, e); }
          }
          chapterImageMap[imgSrc] = imageMap[imgSrc] || imgFilename;
        }

        xhtml = EinkOptimizer.processChapter(xhtml, chapterImageMap);
        zip.file(`OEBPS/Text/${filename}`, xhtml);
        chapters.push({ filename, title: chapterTitle });

        completedChapters++;
        chrome.runtime.sendMessage({
          action: 'progress',
          chapter: completedChapters,
          totalChapters,
          images: Object.keys(imageMap).length,
          totalImages,
        });
      }
    }

    const meta = await fetchBookMetadata(isbn);
    const bookTitle = meta.title;
    const authors = meta.authors || ['Unknown Author'];

    const metadata = {
      title: bookTitle, authors, isbn,
      language: 'en',
      modified: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    };

    const allCssFiles = [...cssFilenames, 'eink-override.css'];
    const allImageFiles = [...new Set(Object.values(imageMap))];

    const coverImage = allImageFiles.find(f => /cover/i.test(f));
    if (coverImage) {
      zip.file('OEBPS/Text/cover.xhtml', EpubBuilder.generateCoverXhtml(bookTitle, coverImage));
      chapters.unshift({ filename: 'cover.xhtml', title: 'Cover' });
    }

    zip.file('OEBPS/content.opf', EpubBuilder.generateOpf(metadata, chapters, allImageFiles, allCssFiles, coverImage || null));
    zip.file('OEBPS/toc.xhtml', EpubBuilder.generateTocXhtml(metadata.title, chapters));
    zip.file('OEBPS/toc.ncx', EpubBuilder.generateTocNcx(isbn, metadata.title, chapters));

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
    const url = URL.createObjectURL(blob);
    const sanitizedTitle = bookTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizedTitle}.epub`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    zipInstance = null;
    chrome.runtime.sendMessage({ action: 'downloadComplete' });
  }

  detectBook();
})();
