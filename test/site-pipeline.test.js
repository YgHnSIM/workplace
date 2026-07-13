const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  parseSrcset,
  resolveReference,
  validateSite,
} = require('../validate_site');
const {
  findMarkdownSyntaxResidues,
  markdownResidueFixtures,
  parseFrontMatter,
  parseMarkdown,
} = require('../build_mom');
const {
  renderStatementHtml,
  scoreStatementContent,
  selectPrintDensity,
  validateStatementFragment,
} = require('../build_statement');
const { versionedAssetHref } = require('../lib/site-utils');
const { stageSite } = require('../scripts/stage-site');
const { verifyGeneratedFiles } = require('../scripts/verify-generated');

const temporaryDirectories = [];

function write(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function html(body = '<h1>Fixture</h1>') {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fixture</title>
  <meta name="description" content="Fixture description">
  <link rel="canonical" href="https://example.com/workplace/fixture.html">
  <meta property="og:title" content="Fixture">
  <meta property="og:description" content="Fixture description">
  <meta property="og:url" content="https://example.com/workplace/fixture.html">
  <meta property="og:image" content="https://example.com/image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Fixture">
  <meta name="twitter:description" content="Fixture description">
  <meta name="twitter:image" content="https://example.com/image.png">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>
</head>
<body>${body}</body>
</html>
`;
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-site-'));
  temporaryDirectories.push(root);

  write(path.join(root, 'index.html'), html());
  write(path.join(root, '.nojekyll'));
  write(path.join(root, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  write(path.join(root, 'sitemap.xml'), '<?xml version="1.0"?><urlset></urlset>\n');
  ['assets', 'MoM', 'statement', 'knowledge', 'notice'].forEach((directory) => {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  });
  ['MoM', 'knowledge', 'notice'].forEach((directory) => {
    write(path.join(root, directory, 'index.html'), html());
  });
  write(path.join(root, '_source', 'catalog.json'), '{"documents":[]}\n');
  write(path.join(root, '_source', 'generated', 'mom.json'), '[]\n');
  fs.mkdirSync(path.join(root, '_source', 'MoM'), { recursive: true });
  return root;
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test.after(() => {
  temporaryDirectories.forEach((directory) => fs.rmSync(directory, { recursive: true, force: true }));
});

test('clean staging removes stale files and copies only the public allowlist', () => {
  const root = createFixture();
  write(path.join(root, '_site', 'private.txt'), 'stale');
  write(path.join(root, 'private-notes.md'), 'not public');

  const result = stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  assert.equal(fs.existsSync(path.join(root, '_site', 'private.txt')), false);
  assert.equal(fs.existsSync(path.join(root, '_site', 'private-notes.md')), false);
  assert.deepEqual(result.rootFiles, [
    '.nojekyll', 'MoM', 'assets', 'index.html', 'knowledge', 'notice',
    'robots.txt', 'sitemap.xml', 'statement',
  ]);
});

test('a minimal staged Pages artifact passes validation', () => {
  const root = createFixture();
  stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  const result = validateSite({
    projectRoot: root,
    siteRoot: path.join(root, '_site'),
    pagesBasePath: '/workplace/',
  });

  assert.deepEqual(result.errors, []);
});

test('HTML parsing catches single-quoted unsafe URLs and inline handlers', () => {
  const root = createFixture();
  write(
    path.join(root, 'index.html'),
    html("<h1>Fixture</h1><a href='java&#x09;script:alert(1)' onclick='alert(1)'>Bad link</a>"),
  );
  stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  const result = validateSite({ projectRoot: root, siteRoot: path.join(root, '_site') });

  assert.ok(result.errors.some((error) => error.includes('unsafe javascript: URL')));
  assert.ok(result.errors.some((error) => error.includes('inline event handler onclick')));
});

test('srcset and poster URLs are resolved from parsed attributes', () => {
  const root = createFixture();
  ['image.png', 'image-2x.png', 'poster.png'].forEach((name) => write(path.join(root, 'assets', name)));
  write(
    path.join(root, 'index.html'),
    html(`<h1>Fixture</h1>
      <img src="assets/image.png" srcset='assets/image.png 1x, assets/image-2x.png 2x' width="10" height="10" alt="">
      <video poster='assets/poster.png'></video>`),
  );
  stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  const result = validateSite({ projectRoot: root, siteRoot: path.join(root, '_site') });

  assert.deepEqual(result.errors, []);
  assert.deepEqual(parseSrcset('one.png 1x, two.png 2x'), [
    { url: 'one.png', descriptor: '1x' },
    { url: 'two.png', descriptor: '2x' },
  ]);
});

test('Pages root-relative URLs must include the configured project base path', () => {
  const root = createFixture();
  const context = {
    attribute: 'href',
    documents: new Map(),
    filePath: path.join(root, 'index.html'),
    pagesBasePath: '/workplace/',
    siteRoot: root,
  };

  const valid = resolveReference('/workplace/index.html', context);
  const invalid = resolveReference('/index.html', context);

  assert.equal(valid.targetPath, path.join(root, 'index.html'));
  assert.match(invalid.error, /bypasses the Pages base path/);
});

test('layout regressions catch Markdown residue, missing image dimensions, and eager iframes', () => {
  const root = createFixture();
  write(path.join(root, 'assets', 'image.png'));
  write(
    path.join(root, 'index.html'),
    html(`<h1>Fixture</h1><p>Unclosed **marker</p>
      <img src="assets/image.png" alt="Fixture">
      <iframe src="https://example.com/embed" title="Fixture"></iframe>`),
  );
  stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  const result = validateSite({ projectRoot: root, siteRoot: path.join(root, '_site') });

  assert.ok(result.errors.some((error) => error.includes('raw ** emphasis marker')));
  assert.ok(result.errors.some((error) => error.includes('positive integer width and height')));
  assert.ok(result.errors.some((error) => error.includes('iframe must use loading="lazy"')));
});

test('manifest comparison rejects stale MoM HTML', () => {
  const root = createFixture();
  write(path.join(root, 'MoM', 'orphan.html'), html());
  stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  const result = validateSite({ projectRoot: root, siteRoot: path.join(root, '_site') });

  assert.ok(result.errors.some((error) => error.includes('MoM/orphan.html is stale or orphaned')));
});

test('statement validation rejects orphan public output and orphan source fragments', () => {
  const root = createFixture();
  write(path.join(root, 'statement', 'orphan.html'), html());
  write(path.join(root, 'statement', 'nested', 'orphan.html'), html());
  write(path.join(root, '_source', 'statement', 'orphan.body.html'), '<section></section>');
  write(path.join(root, '_source', 'statement', 'nested', 'orphan.body.html'), '<section></section>');
  stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  const result = validateSite({ projectRoot: root, siteRoot: path.join(root, '_site') });

  assert.ok(result.errors.some((error) => error.includes('statement/orphan.html is stale or orphaned')));
  assert.ok(result.errors.some((error) => error.includes('statement/nested/orphan.html is stale or orphaned')));
  assert.ok(result.errors.some((error) => error.includes('orphan.body.html has no matching statement catalog entry')));
  assert.ok(result.errors.some((error) => error.includes('nested/orphan.body.html has no matching statement catalog entry')));
});

test('catalog schema rejects invalid dates and duplicate public hrefs', () => {
  const root = createFixture();
  write(path.join(root, 'knowledge', 'duplicate.html'), html('<h1>Duplicate</h1>'));
  const document = {
    category: 'knowledge',
    href: 'knowledge/duplicate.html',
    title: 'Duplicate',
    date: '2026-02-30',
    excerpt: 'Duplicate fixture',
    groupOrder: 1,
    order: 1,
  };
  write(
    path.join(root, '_source', 'catalog.json'),
    `${JSON.stringify({ documents: [document, { ...document, order: 2 }] })}\n`,
  );
  stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  const result = validateSite({ projectRoot: root, siteRoot: path.join(root, '_site') });

  assert.ok(result.errors.some((error) => error.includes('valid ISO date')));
  assert.ok(result.errors.some((error) => error.includes('Duplicate document output path')));
});

test('frontmatter slug collisions are rejected before stale output can deploy', () => {
  const root = createFixture();
  const source = (title) => `---
title: "${title}"
date: 2026-07-10
excerpt: "Fixture"
type: minutes
slug: same-output
---
`;
  write(path.join(root, '_source', 'MoM', 'one.md'), source('One'));
  write(path.join(root, '_source', 'MoM', 'two.md'), source('Two'));
  stageSite({ projectRoot: root, outputDir: path.join(root, '_site') });

  const result = validateSite({ projectRoot: root, siteRoot: path.join(root, '_site') });

  assert.ok(result.errors.some((error) => error.includes('Duplicate MoM output path MoM/same-output.html')));
});

test('generated-file drift check passes clean commits and rejects rebuilt changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workplace-generated-'));
  temporaryDirectories.push(root);
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'Fixture']);
  write(path.join(root, 'index.html'), 'first build\n');
  git(root, ['add', 'index.html']);
  git(root, ['commit', '--quiet', '-m', 'fixture']);

  assert.doesNotThrow(() => verifyGeneratedFiles({ cwd: root, generatedPaths: ['index.html'] }));
  write(path.join(root, 'index.html'), 'drifted build\n');
  assert.throws(
    () => verifyGeneratedFiles({ cwd: root, generatedPaths: ['index.html'] }),
    /Generated public files are out of date/,
  );
});

test('document TOC keeps a continuous bottom rule without expanding links', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(projectRoot, 'assets', 'interface.css'), 'utf8');
  const commonRule = css.match(/\.document-toc-links\s*\{([^}]*)\}/);

  assert.ok(commonRule, 'common document TOC rule should exist');
  assert.match(commonRule[1], /border-bottom:\s*0;/);
  assert.match(commonRule[1], /box-shadow:\s*inset 0 -1px 0 #111111;/);
  assert.match(
    commonRule[1],
    /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(180px,\s*1fr\)\);/,
  );
  assert.doesNotMatch(
    css,
    /\.document-toc-link[^\{]*:last-child\s*\{[^}]*grid-column:/s,
    'the visual rule must not enlarge a link into empty grid columns',
  );

  [
    'principal-employer-bargaining-video-analysis.html',
    'retirement-benefit-db-dc-guide.html',
  ].forEach((name) => {
    const html = fs.readFileSync(path.join(projectRoot, 'knowledge', name), 'utf8');
    assert.doesNotMatch(
      html,
      /<style>[\s\S]*?\.document-toc-links\s*\{/,
      `${name} should reuse the shared TOC component instead of duplicating it inline`,
    );
  });

  assert.doesNotMatch(css, /max-height:\s*260px/);
  assert.match(css, /\.document-toc-toggle\s*\{/);
  assert.match(css, /\.document-toc\.is-collapsible\[data-collapsed="true"\] \.document-toc-links/);
});

test('archive cards, search controls, and content governance metadata stay semantic', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const index = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, '_source', 'catalog.json'), 'utf8'));

  assert.match(index, /<form class="archive-search" role="search"/);
  assert.match(index, /id="archive-topic-select"/);
  assert.match(index, /<article class="doc-card"/);
  assert.match(index, /<a class="doc-card-link"/);
  assert.doesNotMatch(index, /<a\b[^>]*class="doc-card"/);
  catalog.documents.forEach((document) => {
    assert.match(document.dateModified, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['draft', 'reviewed', 'final'].includes(document.status));
    assert.ok(Array.isArray(document.topics) && document.topics.length > 0);
    assert.ok(Number.isInteger(document.sourceCount) && document.sourceCount > 0);
    assert.ok(typeof document.provenance === 'string' && document.provenance.length > 0);
    assert.ok(document.showProvenance === undefined || typeof document.showProvenance === 'boolean');
    assert.ok(Array.isArray(document.relatedDocuments));
  });
});

test('performance pay distinguishes the two allowances without correction callouts', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const catalog = fs.readFileSync(path.join(projectRoot, '_source', 'catalog.json'), 'utf8');
  const page = fs.readFileSync(path.join(projectRoot, 'notice', '2025-performance-pay.html'), 'utf8');

  assert.match(catalog, /직무수당 100,000원/);
  assert.match(catalog, /근속수당 10,000원/);
  assert.match(page, /직무수당 100,000원/);
  assert.match(page, /근속수당 10,000원/);
  assert.match(catalog, /"showProvenance": false/);
  assert.doesNotMatch(page, /노동조합 성과급 계산 안내 이미지/);
  assert.doesNotMatch(page, /class="correction-note"/);
  assert.doesNotMatch(page, /정정 안내/);
  assert.doesNotMatch(page, /근속수당 표기를 상세 산식과 일치하도록 정정/);
  assert.doesNotMatch(page, /content="직무수당 10,000원/);
});

test('statement demand list and signature keep their reading rhythm and alignment', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'interface.css'), 'utf8');
  const demandRule = css.match(/\.demands li\s*\{([^}]*)\}/);
  const closingRule = css.match(/\.closing-block\s*\{([^}]*)\}/);
  const closingParagraphRule = css.match(/\.closing-block > p\s*\{([^}]*)\}/);
  const closingDividerRule = css.match(/\.closing-block > p \+ p\s*\{([^}]*)\}/);
  const signatureRule = css.match(/\.signature-block\s*\{([^}]*)\}/);
  const signatureDateRule = css.match(/\.signature-date\s*\{([^}]*)\}/);
  const signatureRowRule = css.match(/\.signature-org-row\s*\{([^}]*)\}/);

  assert.ok(demandRule, 'statement demand item rule should exist');
  assert.match(demandRule[1], /line-height:\s*1\.8\s*!important;/);
  assert.match(demandRule[1], /padding:\s*0 0 16px 4px;/);
  assert.ok(closingRule, 'statement closing block rule should exist');
  assert.match(closingRule[1], /padding:\s*12px 28px\s*!important;/);
  assert.ok(closingParagraphRule, 'statement closing row rule should exist');
  assert.match(closingParagraphRule[1], /line-height:\s*1\.55\s*!important;/);
  assert.match(closingParagraphRule[1], /margin:\s*0\s*!important;/);
  assert.match(closingParagraphRule[1], /padding:\s*14px 0\s*!important;/);
  assert.ok(closingDividerRule, 'statement closing row divider should exist');
  assert.match(closingDividerRule[1], /border-top:\s*1px solid #D9D9D9\s*!important;/);
  assert.ok(signatureRule, 'statement signature rule should exist');
  assert.match(signatureRule[1], /text-align:\s*center\s*!important;/);
  assert.ok(signatureDateRule, 'statement signature date rule should exist');
  assert.match(signatureDateRule[1], /font-size:\s*calc\(20px \* var\(--font-scale\)\)\s*!important;/);
  assert.ok(signatureRowRule, 'statement signature organization row should exist');
  assert.match(signatureRowRule[1], /display:\s*flex\s*!important;/);
  assert.match(signatureRowRule[1], /justify-content:\s*center\s*!important;/);
});

test('statement print layout uses the A2 page width with controlled page breaks', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'interface.css'), 'utf8');
  const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, '_source', 'catalog.json'), 'utf8'));
  const statementDocuments = catalog.documents.filter((document) => document.category === 'statement');

  assert.ok(statementDocuments.length > 0, 'at least one statement should be registered');
  statementDocuments.forEach((document) => {
    const statementHtml = fs.readFileSync(path.join(projectRoot, ...document.href.split('/')), 'utf8');
    assert.doesNotMatch(statementHtml, /class="header-top-row"/);
    assert.doesNotMatch(statementHtml, /class="statement-category"/);
    assert.doesNotMatch(statementHtml, /class="statement-meta"/);
    assert.match(statementHtml, /class="statement-identity"[^>]*>[\s\S]*차별 없는 일터[\s\S]*병들지 않는 노동[\s\S]*<\/p>/);
    assert.match(statementHtml, /class="statement-brand-mark"/);
    assert.match(statementHtml, /<h1 class="statement-title">/);
    assert.match(statementHtml, /@page\s*\{\s*margin:\s*18mm 0;\s*size:\s*420mm 594mm;\s*\}/);
    assert.match(statementHtml, /@page :first\s*\{\s*margin-top:\s*0;\s*\}/);
    assert.match(statementHtml, /data-document-toc="false"/);
    assert.match(statementHtml, /data-print-density="(?:short|standard|long)"/);
    assert.match(statementHtml, /class="signature-date"[\s\S]*<time datetime="\d{4}-\d{2}-\d{2}">/);
    assert.match(statementHtml, /class="signature-org-logo"/);
    assert.doesNotMatch(statementHtml, /class="document-toc"/);
  });
  const currentStatement = fs.readFileSync(
    path.join(projectRoot, 'statement', '성명서_202607.html'),
    'utf8',
  );
  assert.match(currentStatement, /data-print-density="long"/);
  assert.match(css, /\.statement-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--statement-brand-mark-size\);/s);
  assert.match(css, /\.statement-identity\s*\{[^}]*font-size:\s*calc\(14px \* var\(--font-scale\)\);[^}]*letter-spacing:\s*0\.035em;/s);
  assert.match(css, /\.statement-identity::before\s*\{[^}]*linear-gradient\(to right, #002FA7 0 72px, #D9D9D9 72px 100%\);/s);
  assert.match(css, /\.statement-brand-mark\s*\{[^}]*grid-column:\s*2;[^}]*height:\s*var\(--statement-brand-mark-size\);[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.statement-brand-mark img\s*\{[^}]*height:\s*100%;[^}]*max-width:\s*none;[^}]*width:\s*auto;/s);
  assert.match(css, /\.statement-title\s*\{[^}]*color:\s*#002FA7\s*!important;/s);
  assert.match(css, /\.statement-header > \.statement-title\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2;/s);
  assert.match(css, /\.statement-header\s*\{[^}]*padding-top:\s*38px\s*!important;/s);
  assert.match(css, /\.statement-container\s*\{[^}]*--statement-print-header-top:\s*24mm;/s);
  assert.match(css, /\.statement-container\[data-print-density="standard"\]\s*\{[^}]*--statement-print-header-top:\s*27mm;/s);
  assert.match(css, /\.statement-container\[data-print-density="short"\]\s*\{[^}]*--statement-print-header-top:\s*30mm;/s);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*\.statement-header\s*\{[^}]*--statement-brand-mark-size:\s*56px;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--statement-brand-mark-size\);/s);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*\.statement-header\s*\{[^}]*padding-top:\s*30px\s*!important;/s);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*\.statement-header \.statement-title\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2;/s);

  assert.match(
    css,
    /\.statement-container\s*\{[^}]*--font-scale:\s*1\.54\s*!important;[^}]*--font-size-base:\s*calc\(17px \* var\(--font-scale\)\);[^}]*--font-size-section-title:\s*calc\(22px \* var\(--font-scale\)\);/s,
  );
  assert.match(css, /\.statement-container\s*\{[^}]*--statement-print-body-leading:\s*1\.76;[^}]*--statement-print-demand-leading:\s*1\.68;[^}]*--statement-print-paragraph-gap:\s*34px;[^}]*--statement-print-section-gap:\s*48px;/s);
  assert.match(
    css,
    /\.statement-container\[data-print-density="standard"\]\s*\{[^}]*--font-scale:\s*1\.62\s*!important;[^}]*--statement-print-title-size:\s*52px;/s,
  );
  assert.match(
    css,
    /\.statement-container\[data-print-density="standard"\]\s*\{[^}]*--statement-print-closing-padding:\s*13px 34px;/s,
  );
  assert.match(
    css,
    /\.statement-container\[data-print-density="short"\]\s*\{[^}]*--font-scale:\s*1\.88\s*!important;[^}]*--statement-print-title-size:\s*60px;/s,
  );
  assert.match(
    css,
    /\.statement-body\s*\{[^}]*max-width:\s*none\s*!important;[^}]*padding:\s*0 15mm 20mm\s*!important;[^}]*width:\s*100%\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-header\s*\{[^}]*padding:\s*var\(--statement-print-header-top\) 15mm 30px\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body section\s*\{[^}]*margin-bottom:\s*var\(--statement-print-section-gap\)\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.section-title\s*\{[^}]*break-after:\s*avoid;[^}]*color:\s*#002FA7\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.body-text\s*\{[^}]*font-weight:\s*700\s*!important;[^}]*line-height:\s*var\(--statement-print-body-leading\)\s*!important;[^}]*margin-bottom:\s*var\(--statement-print-paragraph-gap\)\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.closing-block\s*\{[^}]*break-after:\s*avoid;/s,
  );
  assert.match(
    css,
    /\.statement-title\s*\{[^}]*font-size:\s*var\(--statement-print-title-size\)\s*!important;[^}]*letter-spacing:\s*-0\.035em\s*!important;[^}]*line-height:\s*1\.06\s*!important;[^}]*text-wrap:\s*balance;/s,
  );
  assert.match(
    css,
    /\.statement-body \.demands,[^}]*\.statement-body \.closing-block\s*\{[^}]*break-inside:\s*avoid;[^}]*font-size:\s*var\(--statement-print-box-size\)\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.closing-block\s*\{[^}]*break-after:\s*avoid;[^}]*padding:\s*var\(--statement-print-closing-padding\)\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.demands li\s*\{[^}]*font-weight:\s*700\s*!important;[^}]*line-height:\s*var\(--statement-print-demand-leading\)\s*!important;/s,
  );
  assert.match(css, /\.statement-body \.closing-block > p\s*\{[^}]*line-height:\s*var\(--statement-print-closing-leading\)\s*!important;/s);
  assert.match(
    css,
    /\.statement-body \.signature-date\s*\{[^}]*margin-bottom:\s*var\(--statement-print-signature-gap\)\s*!important;/s,
  );
});

test('meeting document header keeps its title outside the logo and category column', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'interface.css'), 'utf8');

  assert.match(
    css,
    /\.mom-header > \.statement-title\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;[^}]*max-width:\s*none;/s,
  );
  assert.match(
    css,
    /@media \(max-width:\s*768px\)[\s\S]*\.mom-header > \.statement-title\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*auto;/s,
  );
});

test('statement builder reuses the template and selects the one-page print density', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const bodyPath = path.join(projectRoot, 'test', 'fixtures', 'statement', 'sample-one-page.body.html');
  const documentPath = path.join(projectRoot, 'test', 'fixtures', 'statement', 'sample-one-page.json');
  const body = fs.readFileSync(bodyPath, 'utf8');
  const outputPath = path.join(projectRoot, 'statement', 'sample-one-page.html');
  const document = JSON.parse(fs.readFileSync(documentPath, 'utf8'));
  const rendered = renderStatementHtml(document, body, {
    rootDir: projectRoot,
    outputPath,
    sourcePath: bodyPath,
  });

  assert.equal(rendered.density, 'short');
  assert.ok(rendered.score <= 1400);
  assert.ok(rendered.score > scoreStatementContent(rendered.metrics));
  assert.match(rendered.html, /data-document-category="성명서"/);
  assert.match(rendered.html, /data-document-toc="false"/);
  assert.match(rendered.html, /data-print-density="short"/);
  assert.match(rendered.html, /@page\s*\{\s*margin:\s*18mm 0;\s*size:\s*420mm 594mm;\s*\}/);
  assert.match(rendered.html, /@page :first\s*\{\s*margin-top:\s*0;\s*\}/);
  assert.match(rendered.html, /class="statement-brand-mark"[^>]*>[\s\S]*?<img[^>]*width="300" height="84"[^>]*loading="eager"[^>]*alt="">/);
  const brandMark = rendered.html.match(/<span class="statement-brand-mark"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(brandMark, 'statement header should contain the square brand mark');
  assert.match(
    brandMark[1],
    new RegExp(versionedAssetHref(projectRoot, outputPath, 'assets/logo-header-300.webp').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(
    brandMark[1],
    new RegExp(versionedAssetHref(projectRoot, outputPath, 'assets/logo-header-600.webp').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(rendered.html, /<img[^>]*loading="eager"[^>]*decoding="sync"[^>]*fetchpriority="high"[^>]*class="signature-org-logo">/);
  assert.match(rendered.html, /class="statement-identity"/);
  assert.equal((rendered.html.match(/class="section-title"/g) || []).length, 2);
  assert.equal((rendered.html.match(/<li>/g) || []).length, 3);
  assert.equal((rendered.html.match(/class="closing-(?:highlight|text)"/g) || []).length, 3);
  assert.doesNotMatch(rendered.html, /class="document-toc"/);
  assert.match(rendered.html, /<time datetime="2026-07-11">2026년 7월 11일<\/time>/);
  assert.match(
    rendered.html,
    new RegExp(versionedAssetHref(projectRoot, outputPath, 'assets/interface.css').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(
    rendered.html,
    new RegExp(versionedAssetHref(projectRoot, outputPath, 'assets/document-tools.js').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );

  const overridden = renderStatementHtml({ ...document, printDensity: 'standard' }, body, {
    rootDir: projectRoot,
    outputPath,
    sourcePath: bodyPath,
  });
  assert.equal(overridden.automaticDensity, 'short');
  assert.equal(overridden.density, 'standard');
  assert.match(overridden.html, /data-print-density="standard"/);
  assert.throws(
    () => renderStatementHtml({ ...document, printDensity: 'oversized' }, body, {
      rootDir: projectRoot,
      outputPath,
      sourcePath: bodyPath,
    }),
    /printDensity must be short, standard, or long/,
  );
});

test('statement print density responds to both body volume and title length', () => {
  const metrics = {
    characterCount: 500,
    paragraphCount: 0,
    lineBreakCount: 0,
    sectionTitleCount: 1,
    demandCount: 1,
    closingRowCount: 2,
  };
  const shortDocument = { title: '짧은 제목' };
  const longTitleDocument = { title: '긴'.repeat(100) };

  assert.equal(selectPrintDensity(metrics, shortDocument).density, 'short');
  assert.equal(selectPrintDensity(metrics, longTitleDocument).density, 'standard');
  assert.equal(
    selectPrintDensity({ ...metrics, characterCount: 2000 }, shortDocument).density,
    'standard',
  );
  assert.equal(
    selectPrintDensity({ ...metrics, characterCount: 3000 }, shortDocument).density,
    'long',
  );

  const boundaryMetrics = {
    ...metrics,
    characterCount: 1075,
  };
  assert.equal(scoreStatementContent(boundaryMetrics), 1400);
  assert.equal(selectPrintDensity(boundaryMetrics).density, 'short');
  assert.equal(selectPrintDensity({ ...boundaryMetrics, characterCount: 1076 }).density, 'standard');
  assert.equal(scoreStatementContent({ ...boundaryMetrics, characterCount: 2475 }), 2800);
  assert.equal(selectPrintDensity({ ...boundaryMetrics, characterCount: 2475 }).density, 'standard');
  assert.equal(selectPrintDensity({ ...boundaryMetrics, characterCount: 2476 }).density, 'long');
  assert.equal(
    scoreStatementContent({ ...boundaryMetrics, paragraphCount: 2, lineBreakCount: 1 }),
    1525,
  );
});

test('statement builder rejects unsafe or structurally incomplete fragments', () => {
  const samplePath = path.join(process.cwd(), 'test', 'fixtures', 'statement', 'invalid.body.html');
  assert.throws(
    () => validateStatementFragment('<section><h2 class="section-title">제목</h2><p class="body-text">본문</p></section><script>alert(1)</script>', samplePath),
    /unsupported <script>/,
  );
  assert.throws(
    () => validateStatementFragment('<section><h2 class="section-title">제목</h2><p class="body-text">본문</p></section>', samplePath),
    /must contain one closing block/,
  );
  assert.throws(
    () => validateStatementFragment('<section><h2 class="section-title">제목</h2><p class="body-text">본문</p></section><!-- 숨은 주석 -->', samplePath),
    /unsupported comment or doctype/,
  );
});

test('statement renderer inserts only the validated normalized fragment', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const bodyPath = path.join(projectRoot, 'test', 'fixtures', 'statement', 'sample-one-page.body.html');
  const documentPath = path.join(projectRoot, 'test', 'fixtures', 'statement', 'sample-one-page.json');
  const body = `${fs.readFileSync(bodyPath, 'utf8')}\n</div></main>`;
  const document = JSON.parse(fs.readFileSync(documentPath, 'utf8'));
  const outputPath = path.join(projectRoot, 'statement', 'sample-one-page.html');
  const rendered = renderStatementHtml(document, body, {
    rootDir: projectRoot,
    outputPath,
    sourcePath: bodyPath,
  });

  assert.equal((rendered.html.match(/<main\b/g) || []).length, 1);
  assert.equal((rendered.html.match(/<\/main>/g) || []).length, 1);
  assert.ok(rendered.html.indexOf('class="signature-block"') < rendered.html.indexOf('</main>'));
});

test('statement category opts out of automatic document TOC generation', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const script = fs.readFileSync(path.join(projectRoot, 'assets', 'document-tools.js'), 'utf8');
  const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, '_source', 'catalog.json'), 'utf8'));
  const statements = catalog.documents
    .filter((document) => document.category === 'statement')
    .map((document) => fs.readFileSync(path.join(projectRoot, ...document.href.split('/')), 'utf8'));

  assert.match(script, /article\.dataset\.documentCategory === '성명서'/);
  assert.match(script, /article\.dataset\.documentToc === 'false'/);
  statements.forEach((statement) => {
    assert.match(
      statement,
      /<main\b[^>]*class="[^"]*\bdocument-article\b[^"]*"[^>]*data-document-toc="false"/,
    );
  });
});

test('MoM builder regression fixtures reject known Markdown residue', () => {
  markdownResidueFixtures.forEach((fixture) => {
    const issues = findMarkdownSyntaxResidues(fixture.markdown);
    assert.ok(
      issues.some((issue) => issue.code === fixture.expectedCode),
      `${fixture.name} should produce ${fixture.expectedCode}`,
    );
  });
});

test('MoM builder parses frontmatter and renders CommonMark content', () => {
  const source = `---
title: "Fixture minutes"
date: 2026-07-10
excerpt: "Fixture excerpt"
type: minutes
slug: fixture-minutes
---

## Decision

This has **strong text** and [a link](https://example.com).
`;
  const parsedSource = parseFrontMatter(source, path.join(process.cwd(), '_source', 'MoM', 'fixture.md'));
  const rendered = parseMarkdown(parsedSource.body, parsedSource.metadata.title);

  assert.equal(parsedSource.metadata.slug, 'fixture-minutes');
  assert.match(rendered.content, /<strong>strong text<\/strong>/);
  assert.match(rendered.content, /class="content-link"/);
  assert.equal(rendered.toc[0].text, 'Decision');
});
