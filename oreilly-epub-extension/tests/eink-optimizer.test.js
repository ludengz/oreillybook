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
