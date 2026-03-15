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
