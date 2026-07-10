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
    ['principal-employer-bargaining-video-analysis.html', '190px'],
    ['retirement-benefit-db-dc-guide.html', '180px'],
  ].forEach(([name, minimumWidth]) => {
    const html = fs.readFileSync(path.join(projectRoot, 'knowledge', name), 'utf8');
    const inlineRule = html.match(/\.document-toc-links\s*\{([^}]*)\}/);

    assert.ok(inlineRule, `${name} should define its TOC grid`);
    assert.match(
      inlineRule[1],
      new RegExp(`grid-template-columns:\\s*repeat\\(auto-fit,\\s*minmax\\(${minimumWidth},\\s*1fr\\)\\);`),
    );
  });
});

test('statement demand list and signature keep their reading rhythm and alignment', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'interface.css'), 'utf8');
  const demandRule = css.match(/\.demands li\s*\{([^}]*)\}/);
  const signatureRule = css.match(/\.signature-block\s*\{([^}]*)\}/);
  const signatureDateRule = css.match(/\.signature-date\s*\{([^}]*)\}/);
  const signatureRowRule = css.match(/\.signature-org-row\s*\{([^}]*)\}/);

  assert.ok(demandRule, 'statement demand item rule should exist');
  assert.match(demandRule[1], /line-height:\s*1\.8\s*!important;/);
  assert.match(demandRule[1], /padding:\s*0 0 16px 4px;/);
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
  const statementFile = fs.readdirSync(path.join(projectRoot, 'statement'))
    .find((name) => name.endsWith('.html'));
  const statementHtml = fs.readFileSync(path.join(projectRoot, 'statement', statementFile), 'utf8');

  assert.doesNotMatch(statementHtml, /class="header-top-row"/);
  assert.doesNotMatch(statementHtml, /class="statement-category"/);
  assert.doesNotMatch(statementHtml, /class="statement-meta"/);
  assert.match(statementHtml, /class="statement-identity"[^>]*>[\s\S]*차별 없는 일터[\s\S]*병들지 않는 노동[\s\S]*<\/p>/);
  assert.match(css, /\.statement-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(css, /\.statement-identity\s*\{[^}]*font-size:\s*calc\(14px \* var\(--font-scale\)\);[^}]*letter-spacing:\s*0\.035em;/s);
  assert.match(css, /\.statement-identity::before\s*\{[^}]*linear-gradient\(to right, #002FA7 0 72px, #D9D9D9 72px 100%\);/s);
  assert.match(css, /\.statement-title\s*\{[^}]*grid-column:\s*1;[^}]*color:\s*#002FA7\s*!important;/s);

  assert.match(
    css,
    /\.statement-container\s*\{[^}]*--font-scale:\s*1\.5\s*!important;[^}]*--font-size-base:\s*calc\(17px \* var\(--font-scale\)\);[^}]*--font-size-section-title:\s*calc\(22px \* var\(--font-scale\)\);/s,
  );
  assert.match(
    css,
    /\.statement-body\s*\{[^}]*max-width:\s*none\s*!important;[^}]*padding:\s*0 15mm 20mm\s*!important;[^}]*width:\s*100%\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-header\s*\{[^}]*padding:\s*56px 15mm 30px\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body section\s*\{[^}]*margin-bottom:\s*42px\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.section-title\s*\{[^}]*break-after:\s*avoid;[^}]*color:\s*#002FA7\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.body-text\s*\{[^}]*font-weight:\s*700\s*!important;[^}]*line-height:\s*1\.68\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.closing-block\s*\{[^}]*break-after:\s*avoid;/s,
  );
  assert.match(
    css,
    /\.statement-title\s*\{[^}]*font-size:\s*48px\s*!important;[^}]*letter-spacing:\s*-0\.035em\s*!important;[^}]*line-height:\s*1\.06\s*!important;[^}]*text-wrap:\s*balance;/s,
  );
  assert.match(
    css,
    /\.statement-body \.demands,[^}]*\.statement-body \.closing-block\s*\{[^}]*break-inside:\s*avoid;[^}]*font-size:\s*22px\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.demands li\s*\{[^}]*font-weight:\s*700\s*!important;[^}]*line-height:\s*1\.6\s*!important;/s,
  );
  assert.match(
    css,
    /\.statement-body \.signature-date\s*\{[^}]*margin-bottom:\s*36px\s*!important;/s,
  );
});

test('statement category opts out of automatic document TOC generation', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const script = fs.readFileSync(path.join(projectRoot, 'assets', 'document-tools.js'), 'utf8');
  const statement = fs.readFileSync(
    path.join(projectRoot, 'statement', '성명서_202607.html'),
    'utf8',
  );

  assert.match(script, /article\.dataset\.documentCategory === '성명서'/);
  assert.match(script, /article\.dataset\.documentToc === 'false'/);
  assert.match(
    statement,
    /<main\b[^>]*class="[^"]*\bdocument-article\b[^"]*"[^>]*data-document-toc="false"/,
  );
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
