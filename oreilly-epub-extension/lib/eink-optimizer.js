const EinkOptimizer = {
  injectOverrideCss(doc) {
    const head = doc.querySelector('head');
    if (head) {
      const link = doc.createElement('link');
      link.setAttribute('rel', 'stylesheet');
      link.setAttribute('type', 'text/css');
      link.setAttribute('href', '../Styles/eink-override.css');
      head.appendChild(link);
    }
  },

  rewriteImagePaths(doc, imageMap) {
    // Rewrite <img src="...">
    doc.querySelectorAll('img[src]').forEach(el => {
      const src = el.getAttribute('src');
      if (imageMap[src]) {
        el.setAttribute('src', `../Images/${imageMap[src]}`);
      }
    });

    // Rewrite <image href="..."> and <image xlink:href="..."> (SVG)
    doc.querySelectorAll('image').forEach(el => {
      const href = el.getAttribute('href');
      if (href && imageMap[href]) {
        el.setAttribute('href', `../Images/${imageMap[href]}`);
      }
      const xlinkNs = 'http://www.w3.org/1999/xlink';
      const xhref = el.getAttributeNS(xlinkNs, 'href');
      if (xhref && imageMap[xhref]) {
        el.setAttributeNS(xlinkNs, 'xlink:href', `../Images/${imageMap[xhref]}`);
      }
    });

    // Rewrite <object data="...">
    doc.querySelectorAll('object[data]').forEach(el => {
      const data = el.getAttribute('data');
      if (data && imageMap[data]) {
        el.setAttribute('data', `../Images/${imageMap[data]}`);
      }
    });
  },

  rewriteCssLinks(doc) {
    doc.querySelectorAll('link[href$=".css"]').forEach(el => {
      const href = el.getAttribute('href');
      const filename = href.split('/').pop();
      el.setAttribute('href', `../Styles/${filename}`);
    });
  },

  // Process a chapter: rewrite paths in DOM, serialize back to string
  processChapter(xhtml, imageMap) {
    const doc = Fetcher.parseXhtml(xhtml);

    this.rewriteCssLinks(doc);
    this.rewriteImagePaths(doc, imageMap);
    this.injectOverrideCss(doc);

    const serializer = new XMLSerializer();
    let result = serializer.serializeToString(doc);

    // Ensure XML declaration is present
    if (!result.startsWith('<?xml')) {
      result = '<?xml version="1.0" encoding="UTF-8"?>\n' + result;
    }
    return result;
  },
};
