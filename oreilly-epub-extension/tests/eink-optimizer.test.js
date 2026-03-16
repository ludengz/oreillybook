describe('EinkOptimizer.processChapter', function() {
  it('injects eink-override.css link', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="styles.css"/></head><body></body></html>';
    const result = EinkOptimizer.processChapter(xhtml, {});
    assertContains(result, 'eink-override.css');
    assert(result.indexOf('styles.css') < result.indexOf('eink-override.css'),
      'eink-override must come after existing stylesheets');
  });

  it('handles XHTML with no existing stylesheets', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body></body></html>';
    assertContains(EinkOptimizer.processChapter(xhtml, {}), 'eink-override.css');
  });

  it('rewrites img src paths to EPUB Images/ dir', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body><img src="../graphics/fig1.png"/></body></html>';
    const result = EinkOptimizer.processChapter(xhtml, { '../graphics/fig1.png': 'fig1.png' });
    assertContains(result, '../Images/fig1.png');
    assert(!result.includes('../graphics/fig1.png'), 'original path should be replaced');
  });

  it('rewrites CSS link href to ../Styles/', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="css/book.css"/></head><body></body></html>';
    const result = EinkOptimizer.processChapter(xhtml, {});
    assertContains(result, '../Styles/book.css');
  });

  it('rewrites SVG image href attributes', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body><svg xmlns="http://www.w3.org/2000/svg"><image href="diagram.svg"/></svg></body></html>';
    const result = EinkOptimizer.processChapter(xhtml, { 'diagram.svg': 'diagram.svg' });
    assertContains(result, '../Images/diagram.svg');
  });

  it('handles HTML entities in image paths correctly', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body><img src="img/a&amp;b.png"/></body></html>';
    // getAttribute('src') decodes &amp; to &, so imageMap key should use decoded form
    const result = EinkOptimizer.processChapter(xhtml, { 'img/a&b.png': 'ab.png' });
    assertContains(result, '../Images/ab.png');
  });

  it('removes OReilly reader-specific wrapper divs', function() {
    const xhtml = '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>T</title></head><body><div class="readable-text intended-text">Duplicate content</div><p>Original content</p></body></html>';
    const result = EinkOptimizer.processChapter(xhtml, {});
    assert(!result.includes('Duplicate content'), 'duplicate content wrapper should be removed');
    assertContains(result, 'Original content');
  });

  it('produces valid XHTML without duplicate html tags and includes xmlns', function() {
    const html = '<!DOCTYPE html><html><head><title>T</title></head><body><p>Text</p></body></html>';
    const result = EinkOptimizer.processChapter(html, {});
    assertContains(result, '<?xml version="1.0"');
    assertContains(result, '<!DOCTYPE html>');
    assertContains(result, 'xmlns="http://www.w3.org/1999/xhtml"');

    // It should not have <html> wrapped inside another <html>
    const matchCount = (result.match(/<html/gi) || []).length;
    assert(matchCount === 1, `Expected exactly 1 <html tag, found ${matchCount}`);
  });
});
