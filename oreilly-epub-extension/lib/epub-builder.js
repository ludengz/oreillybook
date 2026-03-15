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
};
