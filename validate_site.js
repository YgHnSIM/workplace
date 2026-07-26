const fs = require('fs');
const path = require('path');
const parse5 = require('parse5');
const {
  absolutePublicUrl,
  relativeTo,
  toPosixPath,
} = require('./lib/site-utils');
const { CATEGORY_REGISTRY, parseYamlFrontMatter, validateSourceTree } = require('./lib/content-model');
const {
  PUBLIC_DIRECTORIES,
  isAllowedRootFile,
} = require('./scripts/stage-site');

const projectRoot = __dirname;
const URL_ATTRIBUTES = new Set([
  'action',
  'cite',
  'data',
  'formaction',
  'href',
  'poster',
  'src',
  'xlink:href',
]);
const SAFE_EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);
const UNSAFE_SCHEMES = new Set(['blob', 'data', 'file', 'javascript', 'vbscript']);
const PUBLIC_EXTENSIONS = new Set([
  '.avif', '.css', '.gif', '.html', '.ico', '.jpeg', '.jpg', '.js', '.json',
  '.mp4', '.otf', '.png', '.svg', '.ttf', '.txt', '.vtt', '.webm', '.webp',
  '.woff', '.woff2', '.xml',
]);
function normalizePagesBasePath(value = '/') {
  let basePath = String(value || '/').trim().replace(/\\/g, '/');
  if (!basePath.startsWith('/')) basePath = `/${basePath}`;
  basePath = basePath.replace(/\/{2,}/g, '/');
  if (!basePath.endsWith('/')) basePath += '/';
  return basePath;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walkSiteFiles(directory, errors = [], siteRoot = directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];

  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      errors.push(`${relativeTo(siteRoot, fullPath)} is a symbolic link; Pages artifacts must be self-contained`);
      return;
    }
    if (stat.isDirectory()) {
      files.push(...walkSiteFiles(fullPath, errors, siteRoot));
    } else if (stat.isFile()) {
      files.push(fullPath);
    }
  });

  return files;
}

function getAttr(node, name) {
  const attr = (node.attrs || []).find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  return attr ? attr.value : undefined;
}

function hasClass(node, className) {
  return String(getAttr(node, 'class') || '').split(/\s+/).includes(className);
}

function visit(node, callback, ancestors = []) {
  callback(node, ancestors);
  (node.childNodes || []).forEach((child) => visit(child, callback, [...ancestors, node]));
  if (node.content) visit(node.content, callback, [...ancestors, node]);
}

function findElements(document, predicate) {
  const matches = [];
  visit(document, (node) => {
    if (node.tagName && predicate(node)) matches.push(node);
  });
  return matches;
}

function findFirstDescendant(node, predicate) {
  let result;
  visit(node, (candidate) => {
    if (!result && candidate !== node && candidate.tagName && predicate(candidate)) result = candidate;
  });
  return result;
}

function textContent(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map(textContent).join('');
}

function normalizedText(node) {
  return textContent(node).replace(/\s+/g, ' ').trim();
}

function nodeLocation(node) {
  const location = node.sourceCodeLocation;
  return location && location.startLine ? `:${location.startLine}:${location.startCol}` : '';
}

function nodeError(errors, siteRoot, filePath, node, message) {
  errors.push(`${relativeTo(siteRoot, filePath)}${nodeLocation(node)} ${message}`);
}

function parseHtml(filePath, siteRoot, errors) {
  const html = fs.readFileSync(filePath, 'utf8');
  const parseErrors = [];
  const document = parse5.parse(html, {
    sourceCodeLocationInfo: true,
    onParseError: (error) => parseErrors.push(error),
  });

  parseErrors.forEach((error) => {
    errors.push(`${relativeTo(siteRoot, filePath)}:${error.startLine}:${error.startCol} HTML parse error: ${error.code}`);
  });

  return { document, filePath, html };
}

function parseSrcset(value) {
  const input = String(value || '');
  const candidates = [];
  let position = 0;

  while (position < input.length) {
    while (position < input.length && /[\s,]/.test(input[position])) position += 1;
    if (position >= input.length) break;

    const urlStart = position;
    while (position < input.length && !/\s/.test(input[position])) position += 1;
    let url = input.slice(urlStart, position);

    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
      if (url) candidates.push({ url, descriptor: '' });
      continue;
    }

    while (position < input.length && /\s/.test(input[position])) position += 1;
    const descriptorStart = position;
    while (position < input.length && input[position] !== ',') position += 1;
    const descriptor = input.slice(descriptorStart, position).trim();
    if (position < input.length && input[position] === ',') position += 1;
    if (url) candidates.push({ url, descriptor });
  }

  return candidates;
}

function splitReference(value) {
  const input = String(value);
  const hashIndex = input.indexOf('#');
  const queryIndex = input.indexOf('?');
  const pathEnd = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), input.length);
  return {
    pathname: input.slice(0, pathEnd),
    fragment: hashIndex >= 0 ? input.slice(hashIndex + 1) : '',
  };
}

function resolveReference(value, context) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return { error: 'contains an empty URL' };
  if (raw.includes('\\')) return { error: `contains a backslash URL: ${raw}` };

  const schemeProbe = raw.replace(/[\u0000-\u0020]+/g, '');
  if (schemeProbe.startsWith('//')) {
    return { error: `contains a protocol-relative URL: ${raw}` };
  }

  const schemeMatch = schemeProbe.match(/^([a-z][a-z0-9+.-]*):/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (UNSAFE_SCHEMES.has(scheme)) return { error: `contains an unsafe ${scheme}: URL` };
    if (!SAFE_EXTERNAL_SCHEMES.has(scheme)) return { error: `contains an unsupported URL protocol: ${raw}` };
    if ((scheme === 'mailto' || scheme === 'tel') && context.attribute !== 'href') {
      return { error: `uses ${scheme}: in a non-link attribute` };
    }
    return { external: true, scheme };
  }

  const { pathname, fragment } = splitReference(raw);
  let decodedPath;
  let decodedFragment;
  try {
    decodedPath = decodeURIComponent(pathname);
    decodedFragment = decodeURIComponent(fragment);
  } catch {
    return { error: `contains invalid percent-encoding: ${raw}` };
  }

  if (decodedPath.includes('\0') || decodedFragment.includes('\0')) {
    return { error: 'contains a null byte in a URL' };
  }

  const basePath = normalizePagesBasePath(context.pagesBasePath);
  let targetPath;
  if (!decodedPath) {
    targetPath = context.filePath;
  } else if (decodedPath.startsWith('/')) {
    let publicPath;
    if (basePath === '/') {
      publicPath = decodedPath.slice(1);
    } else {
      const baseWithoutTrailingSlash = basePath.slice(0, -1);
      if (decodedPath === baseWithoutTrailingSlash) {
        publicPath = '';
      } else if (decodedPath.startsWith(basePath)) {
        publicPath = decodedPath.slice(basePath.length);
      } else {
        return { error: `bypasses the Pages base path ${basePath}: ${raw}` };
      }
    }
    targetPath = path.resolve(context.siteRoot, publicPath || 'index.html');
  } else {
    targetPath = path.resolve(path.dirname(context.filePath), decodedPath);
  }

  if (!isInside(context.siteRoot, targetPath)) {
    return { error: `references a file outside the site root: ${raw}` };
  }

  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    targetPath = path.join(targetPath, 'index.html');
  }

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return { error: `references a missing file: ${raw}` };
  }

  if (decodedFragment && path.extname(targetPath).toLowerCase() === '.html') {
    const targetDocument = context.documents.get(path.resolve(targetPath));
    if (targetDocument && !targetDocument.ids.has(decodedFragment)) {
      return { error: `references a missing fragment #${decodedFragment} in ${relativeTo(context.siteRoot, targetPath)}` };
    }
  }

  return { targetPath: path.resolve(targetPath), fragment: decodedFragment };
}

function validateReferences(record, context, errors) {
  visit(record.document, (node) => {
    if (!node.tagName) return;

    (node.attrs || []).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        nodeError(errors, context.siteRoot, record.filePath, node, `contains inline event handler ${name}`);
        return;
      }
      if (name === 'srcdoc') {
        nodeError(errors, context.siteRoot, record.filePath, node, 'contains unsafe inline iframe srcdoc content');
        return;
      }

      const srcsetCandidates = name === 'srcset' ? parseSrcset(attr.value) : [];
      srcsetCandidates.forEach((candidate) => {
        const descriptorValue = Number.parseFloat(candidate.descriptor);
        if (candidate.descriptor
          && (!/^(?:\d+w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(candidate.descriptor)
            || !Number.isFinite(descriptorValue)
            || descriptorValue <= 0)) {
          nodeError(errors, context.siteRoot, record.filePath, node, `contains invalid srcset descriptor: ${candidate.descriptor}`);
        }
      });
      const refs = name === 'srcset'
        ? srcsetCandidates.map((candidate) => candidate.url)
        : (URL_ATTRIBUTES.has(name) ? [attr.value] : []);

      if (name === 'srcset' && refs.length === 0) {
        nodeError(errors, context.siteRoot, record.filePath, node, 'contains an empty srcset');
      }

      refs.forEach((ref) => {
        const result = resolveReference(ref, {
          ...context,
          attribute: name,
          filePath: record.filePath,
        });
        if (result.error) {
          nodeError(errors, context.siteRoot, record.filePath, node, `${name} ${result.error}`);
        }
      });
    });

    if (node.tagName === 'base') {
      nodeError(errors, context.siteRoot, record.filePath, node, '<base> is not allowed because it changes Pages URL resolution');
    }
    if (node.tagName === 'meta'
      && /^refresh$/i.test(getAttr(node, 'http-equiv') || '')) {
      nodeError(errors, context.siteRoot, record.filePath, node, 'meta refresh is not allowed');
    }
  });
}

function validateDocumentStructure(record, siteRoot, errors) {
  const { document, filePath, html } = record;
  const elements = findElements(document, () => true);
  const byTag = (tagName) => elements.filter((node) => node.tagName === tagName);

  if (!/^\s*<!doctype\s+html\s*>/i.test(html)) {
    errors.push(`${relativeTo(siteRoot, filePath)} must start with <!DOCTYPE html>`);
  }

  const htmlElements = byTag('html');
  if (htmlElements.length !== 1 || !String(getAttr(htmlElements[0], 'lang') || '').trim()) {
    errors.push(`${relativeTo(siteRoot, filePath)} must have one <html> element with a lang attribute`);
  }

  const titles = byTag('title');
  if (titles.length !== 1 || !normalizedText(titles[0])) {
    errors.push(`${relativeTo(siteRoot, filePath)} must have exactly one non-empty <title>`);
  }

  const descriptions = byTag('meta').filter((node) => /^description$/i.test(getAttr(node, 'name') || ''));
  if (descriptions.length !== 1 || !String(getAttr(descriptions[0], 'content') || '').trim()) {
    errors.push(`${relativeTo(siteRoot, filePath)} must have exactly one non-empty meta description`);
  }

  const viewports = byTag('meta').filter((node) => /^viewport$/i.test(getAttr(node, 'name') || ''));
  if (viewports.length !== 1 || !String(getAttr(viewports[0], 'content') || '').trim()) {
    errors.push(`${relativeTo(siteRoot, filePath)} must have exactly one viewport meta tag`);
  }

  const charsets = byTag('meta').filter((node) => getAttr(node, 'charset') !== undefined);
  if (charsets.length !== 1 || !/^utf-8$/i.test(getAttr(charsets[0], 'charset') || '')) {
    errors.push(`${relativeTo(siteRoot, filePath)} must have exactly one UTF-8 charset meta tag`);
  }

  const canonicals = byTag('link').filter((node) => String(getAttr(node, 'rel') || '').toLowerCase().split(/\s+/).includes('canonical'));
  if (canonicals.length !== 1 || !String(getAttr(canonicals[0], 'href') || '').trim()) {
    errors.push(`${relativeTo(siteRoot, filePath)} must have exactly one canonical link`);
  }

  ['og:title', 'og:description', 'og:url', 'og:image'].forEach((property) => {
    const metas = byTag('meta').filter((node) => getAttr(node, 'property') === property);
    if (metas.length !== 1 || !String(getAttr(metas[0], 'content') || '').trim()) {
      errors.push(`${relativeTo(siteRoot, filePath)} must have exactly one non-empty ${property} meta tag`);
    }
  });
  ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image'].forEach((name) => {
    const metas = byTag('meta').filter((node) => getAttr(node, 'name') === name);
    if (metas.length !== 1 || !String(getAttr(metas[0], 'content') || '').trim()) {
      errors.push(`${relativeTo(siteRoot, filePath)} must have exactly one non-empty ${name} meta tag`);
    }
  });

  const jsonLdScripts = byTag('script').filter((node) => getAttr(node, 'type') === 'application/ld+json');
  if (jsonLdScripts.length === 0) {
    errors.push(`${relativeTo(siteRoot, filePath)} must include JSON-LD metadata`);
  }
  jsonLdScripts.forEach((script) => {
    try {
      JSON.parse(textContent(script));
    } catch (error) {
      nodeError(errors, siteRoot, filePath, script, `contains invalid JSON-LD: ${error.message}`);
    }
  });

  const h1s = byTag('h1');
  if (h1s.length !== 1 || !normalizedText(h1s[0])) {
    errors.push(`${relativeTo(siteRoot, filePath)} must have exactly one non-empty <h1>`);
  }

  const headings = elements.filter((node) => /^h[1-6]$/.test(node.tagName));
  let previousHeadingLevel = 0;
  headings.forEach((heading) => {
    if (!normalizedText(heading)) nodeError(errors, siteRoot, filePath, heading, 'contains an empty heading');
    const level = Number(heading.tagName.slice(1));
    if (previousHeadingLevel && level > previousHeadingLevel + 1) {
      nodeError(errors, siteRoot, filePath, heading, `skips heading level from h${previousHeadingLevel} to h${level}`);
    }
    previousHeadingLevel = level;
  });

  const ids = new Map();
  elements.forEach((node) => {
    const id = getAttr(node, 'id');
    if (!id) return;
    if (ids.has(id)) {
      nodeError(errors, siteRoot, filePath, node, `duplicates id="${id}"`);
    } else {
      ids.set(id, node);
    }
  });

  byTag('img').forEach((image) => {
    const width = getAttr(image, 'width');
    const height = getAttr(image, 'height');
    if (!/^\d+$/.test(width || '') || Number(width) <= 0
      || !/^\d+$/.test(height || '') || Number(height) <= 0) {
      nodeError(errors, siteRoot, filePath, image, 'image must declare positive integer width and height attributes');
    }
    if (getAttr(image, 'alt') === undefined) {
      nodeError(errors, siteRoot, filePath, image, 'image must declare an alt attribute');
    }
  });

  byTag('iframe').forEach((iframe) => {
    if (getAttr(iframe, 'loading') !== 'lazy') {
      nodeError(errors, siteRoot, filePath, iframe, 'iframe must use loading="lazy"');
    }
    if (!String(getAttr(iframe, 'title') || '').trim()) {
      nodeError(errors, siteRoot, filePath, iframe, 'iframe must have a non-empty title');
    }
  });
}

function validateVisibleText(record, siteRoot, errors) {
  const ignoredParents = new Set(['code', 'pre', 'script', 'style', 'template', 'textarea']);
  const findings = new Set();

  visit(record.document, (node, ancestors) => {
    if (node.nodeName !== '#text') return;
    if (ancestors.some((ancestor) => ignoredParents.has(ancestor.tagName))) return;
    const value = node.value || '';
    if (/\*\*/.test(value)) findings.add('raw ** emphasis marker');
    if (/__[^_\n]+__/.test(value)) findings.add('raw __ emphasis marker');
    if (/\\\[[^\]\n]{0,120}\]/.test(value)) findings.add('escaped Markdown bracket');
    if (/\[[^\]\n]+\]\((?:https?:|\.{0,2}\/|#)[^)]+\)/.test(value)) findings.add('raw Markdown link');
    if (/(?:^|\n)\s{0,3}#{1,6}\s+\S/.test(value)) findings.add('raw Markdown heading');
    if (/\b(?:TODO|FIXME)\b/i.test(value)) findings.add('TODO/FIXME marker');
    if (/\?\?/.test(value)) findings.add('placeholder ??');
    if (/�/.test(value)) findings.add('Unicode replacement character');
  });

  findings.forEach((finding) => {
    errors.push(`${relativeTo(siteRoot, record.filePath)} contains ${finding}`);
  });
}

function validateArtifactLayout(siteRoot, errors) {
  if (!fs.existsSync(siteRoot) || !fs.statSync(siteRoot).isDirectory()) {
    errors.push(`Site root does not exist: ${siteRoot}`);
    return [];
  }

  fs.readdirSync(siteRoot, { withFileTypes: true }).forEach((entry) => {
    if (entry.isDirectory() && PUBLIC_DIRECTORIES.includes(entry.name)) return;
    if (entry.isFile() && isAllowedRootFile(entry.name)) return;
    errors.push(`${entry.name} is not allowed at the Pages artifact root`);
  });

  if (!fs.existsSync(path.join(siteRoot, 'index.html'))) errors.push('Pages artifact is missing index.html');
  if (!fs.existsSync(path.join(siteRoot, '.nojekyll'))) errors.push('Pages artifact is missing .nojekyll');
  if (!fs.existsSync(path.join(siteRoot, 'robots.txt'))) errors.push('Pages artifact is missing robots.txt');
  if (!fs.existsSync(path.join(siteRoot, 'sitemap.xml'))) errors.push('Pages artifact is missing sitemap.xml');

  const files = walkSiteFiles(siteRoot, errors, siteRoot);
  files.forEach((filePath) => {
    const relative = relativeTo(siteRoot, filePath);
    if (relative === '.nojekyll') return;
    const extension = path.extname(filePath).toLowerCase();
    if (!PUBLIC_EXTENSIONS.has(extension)) errors.push(`${relative} has a non-public file extension`);
    if (extension === '.md') errors.push(`${relative} exposes raw Markdown`);
    if (/^(?:knowledge|notice)\/test\.html$/i.test(relative)) {
      errors.push(`${relative} is a test page and must not be deployed`);
    }
  });
  return files;
}

function validateArtifactParity(siteRoot, sourceRoot, errors) {
  if (path.resolve(siteRoot) === path.resolve(sourceRoot)) return;

  walkSiteFiles(siteRoot, errors, siteRoot).forEach((artifactFile) => {
    const relative = relativeTo(siteRoot, artifactFile);
    const sourceFile = path.join(sourceRoot, ...relative.split('/'));
    if (relative === '.nojekyll' && !fs.existsSync(sourceFile)) return;
    if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
      errors.push(`${relative} has no matching public source file`);
      return;
    }
    if (!fs.readFileSync(artifactFile).equals(fs.readFileSync(sourceFile))) {
      errors.push(`${relative} differs from the built public source`);
    }
  });
}

function readContentDocuments(sourceRoot, siteRoot, errors) {
  const catalogProbe = path.join(sourceRoot, '_source', 'catalog.json');
  let parsedCatalog;
  if (fs.existsSync(catalogProbe)) {
    try { parsedCatalog = JSON.parse(fs.readFileSync(catalogProbe, 'utf8')); } catch { parsedCatalog = undefined; }
  }
  if (parsedCatalog && parsedCatalog.schemaVersion === 2) {
    const sourceResult = validateSourceTree({ projectRoot: sourceRoot, allowLegacy: false });
    sourceResult.errors.forEach((error) => errors.push(error));
    const graph = sourceResult.data;
    if (!sourceResult.success || !graph) {
      return { allDocs: [], listedDocs: [], manualDocs: [], momDocs: [] };
    }
    const toLegacy = (record) => ({
      ...record,
      href: record.route,
      normalizedHref: record.route,
      date: record.dates.publishedOn,
      dateModified: record.dates.modifiedOn,
      excerpt: record.summary,
      status: record.workflow.status,
      visibility: record.workflow.visibility,
      topics: record.topicIds.map((topicId) => graph.topicsById.get(topicId)?.label || topicId),
      sourceCount: record.evidence.count,
      provenance: record.evidence.note,
      showProvenance: record.evidence.noteVisibility === 'public',
      relatedDocuments: record.relatedDocumentIds.map((id) => graph.documentsById.get(id)?.route).filter(Boolean),
      normalizedRelatedDocuments: record.relatedDocumentIds.map((id) => graph.documentsById.get(id)?.route).filter(Boolean),
    });
    const allDocs = graph.documents.map(toLegacy);
    const listedDocs = graph.listedDocuments.map(toLegacy);
    const manualDocs = allDocs.filter((doc) => doc.category !== 'mom');
    const momDocs = allDocs.filter((doc) => doc.category === 'mom');
    allDocs.forEach((doc) => {
      const target = path.join(siteRoot, ...doc.normalizedHref.split('/'));
      if (!fs.existsSync(target)) errors.push(`Document target is missing from the artifact: ${doc.normalizedHref}`);
    });
    return { allDocs, listedDocs, manualDocs, momDocs, graph };
  }

  errors.push('_source/catalog.json: schemaVersion must be 2');
  return { allDocs: [], listedDocs: [], manualDocs: [], momDocs: [] };
}

function validateMomOutputs(sourceRoot, siteRoot, momDocs, errors) {
  const graphRoutes = new Set(momDocs.map((doc) => doc.normalizedHref));
  const publicMomDir = path.join(siteRoot, 'MoM');
  if (fs.existsSync(publicMomDir)) {
    fs.readdirSync(publicMomDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.html' && entry.name !== 'index.html')
      .forEach((entry) => {
        const href = `MoM/${entry.name}`;
        if (!graphRoutes.has(href)) errors.push(`${href} is stale or orphaned (not present in the content graph)`);
      });
  }

  const sourceDir = path.join(sourceRoot, '_source', 'MoM');
  if (!fs.existsSync(sourceDir)) return;
  const sourceOutputs = new Map();
  fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.md' && entry.name !== 'README.md')
    .forEach((entry) => {
      const sourcePath = path.join(sourceDir, entry.name);
      const markdown = fs.readFileSync(sourcePath, 'utf8');
      let frontmatter;
      try {
        frontmatter = parseYamlFrontMatter(markdown, `_source/MoM/${entry.name}`).metadata;
      } catch (error) {
        errors.push(error.message);
        return;
      }
      const legacyMatch = entry.name.match(/^(\d{6})/);
      const rawRoute = frontmatter.route || `MoM/${frontmatter.slug || (legacyMatch ? legacyMatch[1] : path.basename(entry.name, '.md'))}.html`;
      const href = String(rawRoute).replace(/\\/g, '/');
      if (!/^MoM\/[^/?#%]+\.html$/u.test(href) || href.includes('..')) {
        errors.push(`_source/MoM/${entry.name} has an unsafe or empty route: ${rawRoute}`);
        return;
      }
      const key = href.toLocaleLowerCase('en');
      if (sourceOutputs.has(key)) {
        errors.push(`Duplicate MoM output path ${href}: ${sourceOutputs.get(key)} and ${entry.name}`);
      } else {
        sourceOutputs.set(key, entry.name);
      }
      if (!graphRoutes.has(href)) {
        errors.push(`_source/MoM/${entry.name} expects ${href}, but the content graph does not contain it`);
      }
    });

  graphRoutes.forEach((href) => {
    if (!sourceOutputs.has(href.toLocaleLowerCase('en'))) {
      errors.push(`Content graph entry has no matching MoM source route: ${href}`);
    }
  });
}

function validateStatementOutputs(sourceRoot, siteRoot, manualDocs, errors) {
  const statementDocs = manualDocs.filter((doc) => doc.category === 'statement');
  const expectedHrefs = new Set(statementDocs.map((doc) => doc.normalizedHref));
  const expectedKeys = new Set([...expectedHrefs].map((href) => href.toLocaleLowerCase('en')));
  const publicStatementDir = path.join(siteRoot, 'statement');

  if (fs.existsSync(publicStatementDir)) {
    walkSiteFiles(publicStatementDir, errors, siteRoot)
      .filter((filePath) => (
        path.extname(filePath).toLowerCase() === '.html'
        && path.basename(filePath).toLowerCase() !== 'index.html'
      ))
      .forEach((filePath) => {
        const href = toPosixPath(path.relative(siteRoot, filePath));
        if (!expectedKeys.has(href.toLocaleLowerCase('en'))) {
          errors.push(`${href} is stale or orphaned (not present in _source/catalog.json)`);
        }
      });
  }

  const sourceStatementDir = path.join(sourceRoot, '_source', 'statement');
  const sourceHrefs = new Set();
  if (fs.existsSync(sourceStatementDir)) {
    walkSiteFiles(sourceStatementDir, errors, sourceRoot)
      .filter((filePath) => filePath.endsWith('.body.html'))
      .forEach((filePath) => {
        const relativeSource = toPosixPath(path.relative(sourceStatementDir, filePath));
        const outputName = relativeSource.slice(0, -'.body.html'.length);
        const href = `statement/${outputName}.html`;
        const key = href.toLocaleLowerCase('en');
        if (sourceHrefs.has(key)) {
          errors.push(`Duplicate statement source output: ${href}`);
        }
        sourceHrefs.add(key);
        if (!expectedKeys.has(key)) {
          errors.push(`_source/statement/${relativeSource} has no matching statement catalog entry`);
        }
      });
  }

  expectedHrefs.forEach((href) => {
    if (!sourceHrefs.has(href.toLocaleLowerCase('en'))) {
      const outputName = path.posix.basename(href, '.html');
      errors.push(`Statement catalog entry ${href} is missing _source/statement/${outputName}.body.html`);
    }
  });
}

function publicPathForReference(ref, record, context) {
  const result = resolveReference(ref, {
    ...context,
    attribute: 'href',
    filePath: record.filePath,
  });
  if (result.error || result.external || !result.targetPath) return undefined;
  return relativeTo(context.siteRoot, result.targetPath);
}

function validateIndexCards(relativeIndex, expectedDocs, context, errors) {
  const indexPath = path.join(context.siteRoot, ...relativeIndex.split('/'));
  const record = context.documents.get(path.resolve(indexPath));
  if (!record) {
    errors.push(`${relativeIndex} is missing or could not be parsed`);
    return;
  }

  const cards = findElements(record.document, (node) => node.tagName === 'article' && hasClass(node, 'doc-card'));
  const cardsByHref = new Map();
  cards.forEach((card) => {
    const link = findFirstDescendant(card, (node) => node.tagName === 'a' && hasClass(node, 'doc-card-link'));
    if (!link) {
      nodeError(errors, context.siteRoot, indexPath, card, 'document card is missing its title link');
      return;
    }
    const href = getAttr(link, 'href');
    const publicPath = publicPathForReference(href, record, context);
    if (!publicPath) return;
    if (cardsByHref.has(publicPath)) {
      nodeError(errors, context.siteRoot, indexPath, card, `duplicates document card for ${publicPath}`);
    } else {
      cardsByHref.set(publicPath, card);
    }
  });

  const expectedByHref = new Map(expectedDocs.map((doc) => [doc.normalizedHref, doc]));
  expectedByHref.forEach((doc, href) => {
    const card = cardsByHref.get(href);
    if (!card) {
      errors.push(`${relativeIndex} does not contain a document card for ${href}`);
      return;
    }
    const title = findFirstDescendant(card, (node) => hasClass(node, 'doc-title'));
    const excerpt = findFirstDescendant(card, (node) => hasClass(node, 'doc-excerpt'));
    const date = findFirstDescendant(card, (node) => hasClass(node, 'doc-date'));
    if (title && normalizedText(title) !== doc.title.trim()) {
      errors.push(`${relativeIndex} has drifted title text for ${href}`);
    }
    if (excerpt && normalizedText(excerpt) !== doc.excerpt.trim().replace(/\s+/g, ' ')) {
      errors.push(`${relativeIndex} has drifted excerpt text for ${href}`);
    }
    const renderedDate = date && (getAttr(date, 'datetime') || normalizedText(date));
    if (date && renderedDate !== doc.date.trim()) {
      errors.push(`${relativeIndex} has drifted date text for ${href}`);
    }
  });
  cardsByHref.forEach((_card, href) => {
    if (!expectedByHref.has(href)) errors.push(`${relativeIndex} contains an unexpected or stale document card for ${href}`);
  });
}

function metaContent(document, attribute, value) {
  const match = findElements(document, (node) => node.tagName === 'meta'
    && getAttr(node, attribute) === value)[0];
  return match ? getAttr(match, 'content') : undefined;
}

function linkContent(document, rel) {
  const match = findElements(document, (node) => node.tagName === 'link'
    && getAttr(node, 'rel') === rel)[0];
  return match ? getAttr(match, 'href') : undefined;
}

function parseJsonLd(document, label, errors) {
  const script = findElements(document, (node) => node.tagName === 'script'
    && getAttr(node, 'type') === 'application/ld+json')[0];
  if (!script) {
    errors.push(`${label} is missing JSON-LD`);
    return undefined;
  }
  try {
    return JSON.parse(textContent(script));
  } catch (error) {
    errors.push(`${label} contains invalid JSON-LD: ${error.message}`);
    return undefined;
  }
}

function jsonLdNodes(jsonLd) {
  if (!jsonLd || typeof jsonLd !== 'object') return [];
  return Array.isArray(jsonLd['@graph']) ? jsonLd['@graph'] : [jsonLd];
}

function validateCollectionMetadata(relativeIndex, expectedDocs, context, errors) {
  const indexPath = path.join(context.siteRoot, ...relativeIndex.split('/'));
  const record = context.documents.get(path.resolve(indexPath));
  if (!record) return;
  if (findElements(record.document, (node) => node.tagName === 'meta'
    && ['article:published_time', 'article:modified_time'].includes(getAttr(node, 'property'))).length) {
    errors.push(`${relativeIndex} must not contain article date metadata`);
  }
  const jsonLd = parseJsonLd(record.document, relativeIndex, errors);
  const collection = jsonLdNodes(jsonLd).find((node) => node['@type'] === 'CollectionPage');
  if (!collection) {
    errors.push(`${relativeIndex} JSON-LD must contain CollectionPage`);
    return;
  }
  const list = collection.mainEntity;
  if (!list || list['@type'] !== 'ItemList') {
    errors.push(`${relativeIndex} JSON-LD must contain an ItemList`);
    return;
  }
  const urls = Array.isArray(list.itemListElement)
    ? list.itemListElement.map((item) => item.url).filter(Boolean)
    : [];
  const expected = expectedDocs.map((doc) => absolutePublicUrl(doc.normalizedHref));
  if (list.numberOfItems !== expected.length) {
    errors.push(`${relativeIndex} JSON-LD ItemList numberOfItems does not match the content graph`);
  }
  if (JSON.stringify(urls) !== JSON.stringify(expected)) {
    errors.push(`${relativeIndex} JSON-LD ItemList does not match the content graph`);
  }
}

function validateDocumentMetadata(docs, context, errors) {
  const docsByHref = new Map(docs.map((doc) => [doc.normalizedHref, doc]));
  const organizationId = `${absolutePublicUrl()}#organization`;
  docs.forEach((doc) => {
    const targetPath = path.join(context.siteRoot, ...doc.normalizedHref.split('/'));
    const record = context.documents.get(path.resolve(targetPath));
    if (!record) return;
    const h1s = findElements(record.document, (node) => node.tagName === 'h1');
    if (h1s.length === 1 && normalizedText(h1s[0]) !== doc.title.trim()) {
      errors.push(`${doc.normalizedHref} h1 does not match its catalog/manifest title`);
    }
    const canonical = absolutePublicUrl(doc.normalizedHref);
    const expectedImage = absolutePublicUrl(doc.socialImage || 'assets/social-card.png');
    const checks = [
      ['name', 'description', doc.summary || doc.excerpt],
      ['property', 'og:description', doc.summary || doc.excerpt],
      ['property', 'og:title', doc.title],
      ['property', 'og:url', canonical],
      ['name', 'twitter:description', doc.summary || doc.excerpt],
      ['name', 'twitter:title', doc.title],
      ['property', 'og:image', expectedImage],
      ['name', 'twitter:image', expectedImage],
    ];
    checks.forEach(([attribute, value, expected]) => {
      const actual = metaContent(record.document, attribute, value);
      if (actual !== expected) errors.push(`${doc.normalizedHref} ${value} metadata does not match the content graph`);
    });
    if (linkContent(record.document, 'canonical') !== canonical) {
      errors.push(`${doc.normalizedHref} canonical URL does not match the content graph`);
    }
    const robots = metaContent(record.document, 'name', 'robots');
    if (doc.visibility === 'unlisted' && robots !== 'noindex,follow') {
      errors.push(`${doc.normalizedHref} unlisted document must use noindex,follow`);
    }
    if (doc.visibility === 'public' && robots) errors.push(`${doc.normalizedHref} public document must not use robots noindex`);
    const publishedMeta = metaContent(record.document, 'property', 'article:published_time');
    const modifiedMeta = metaContent(record.document, 'property', 'article:modified_time');
    if (publishedMeta !== doc.date) errors.push(`${doc.normalizedHref} published date metadata does not match the content graph`);
    if (modifiedMeta !== doc.dateModified) errors.push(`${doc.normalizedHref} modified date metadata does not match the content graph`);
    const jsonLd = parseJsonLd(record.document, doc.normalizedHref, errors);
    const nodes = jsonLdNodes(jsonLd);
    const organization = nodes.find((node) => node['@type'] === 'Organization');
    const website = nodes.find((node) => node['@type'] === 'WebSite');
    const webPage = nodes.find((node) => node['@type'] === 'WebPage');
    const creative = nodes.find((node) => ['Article', 'Report'].includes(node['@type']));
    if (!organization || organization['@id'] !== organizationId || organization.name !== '우체국물류지원단 물류노동조합') {
      errors.push(`${doc.normalizedHref} JSON-LD must contain the stable organization`);
    }
    if (!website || website['@id'] !== `${absolutePublicUrl()}#website` || website.url !== absolutePublicUrl()) {
      errors.push(`${doc.normalizedHref} JSON-LD must contain the stable website`);
    }
    if (!webPage || webPage['@id'] !== canonical) {
      errors.push(`${doc.normalizedHref} JSON-LD WebPage ID must equal canonical URL`);
    } else if (webPage.name !== doc.title || webPage.description !== (doc.summary || doc.excerpt)
      || webPage.url !== canonical) {
      errors.push(`${doc.normalizedHref} JSON-LD WebPage values do not match the content graph`);
    }
    const expectedCreativeType = doc.category === 'mom' && doc.type === 'report' ? 'Report' : 'Article';
    if (!creative || creative['@type'] !== expectedCreativeType) {
      errors.push(`${doc.normalizedHref} JSON-LD must use ${expectedCreativeType}`);
    } else {
      const expectedCreativeId = `${absolutePublicUrl()}#document-${encodeURIComponent(doc.id)}`;
      if (creative.description !== (doc.summary || doc.excerpt)) errors.push(`${doc.normalizedHref} JSON-LD description does not match the content graph`);
      if (creative.name !== doc.title || creative.headline !== doc.title) errors.push(`${doc.normalizedHref} JSON-LD title does not match the content graph`);
      if (creative['@id'] !== expectedCreativeId || creative.url !== canonical) errors.push(`${doc.normalizedHref} JSON-LD CreativeWork ID or URL is unstable`);
      if (creative.image !== expectedImage) errors.push(`${doc.normalizedHref} JSON-LD image does not match the content graph`);
      if (creative.datePublished !== doc.date) errors.push(`${doc.normalizedHref} JSON-LD datePublished does not match the content graph`);
      if (creative.dateModified !== doc.dateModified) errors.push(`${doc.normalizedHref} JSON-LD dateModified does not match the content graph`);
      if (creative.creativeWorkStatus !== doc.status) errors.push(`${doc.normalizedHref} JSON-LD creativeWorkStatus does not match the content graph`);
      if (creative.author?.['@id'] !== organizationId || creative.publisher?.['@id'] !== organizationId) {
        errors.push(`${doc.normalizedHref} JSON-LD author and publisher must be the organization`);
      }
      const aboutIds = Array.isArray(creative.about) ? creative.about.map((topic) => topic.identifier) : [];
      if (JSON.stringify(aboutIds) !== JSON.stringify(doc.topicIds || [])) {
        errors.push(`${doc.normalizedHref} JSON-LD topics do not match the content graph`);
      }
      if (creative.mainEntityOfPage?.['@id'] !== canonical) {
        errors.push(`${doc.normalizedHref} JSON-LD mainEntityOfPage does not match the canonical URL`);
      }
    }
    findElements(record.document, (node) => node.tagName === 'a' && hasClass(node, 'related-document'))
      .forEach((link) => {
        const target = publicPathForReference(getAttr(link, 'href'), record, context);
        const related = target && docsByHref.get(target);
        if (related && related.visibility !== 'public') {
          errors.push(`${doc.normalizedHref} exposes an unlisted related document: ${target}`);
        }
      });
  });
}

function validateContentIndexes(content, context, errors) {
  const listedDocs = content.listedDocs || content.allDocs;
  validateIndexCards('index.html', listedDocs, context, errors);
  validateIndexCards('MoM/index.html', listedDocs.filter((doc) => doc.category === 'mom'), context, errors);
  ['statement', 'knowledge', 'notice'].forEach((category) => {
    validateIndexCards(
      `${category}/index.html`,
      listedDocs.filter((doc) => doc.category === category),
      context,
      errors,
    );
  });
  if (content.graph && content.allDocs.length > 0) {
    validateDocumentMetadata(content.allDocs, context, errors);
    validateCollectionMetadata('index.html', listedDocs, context, errors);
    validateCollectionMetadata(
      'MoM/index.html',
      listedDocs.filter((doc) => doc.category === 'mom'),
      context,
      errors,
    );
    ['statement', 'knowledge', 'notice'].forEach((category) => {
      validateCollectionMetadata(
        `${category}/index.html`,
        listedDocs.filter((doc) => doc.category === category),
        context,
        errors,
      );
    });
  }
}

function validateSitemap(docs, siteRoot, errors) {
  const sitemapPath = path.join(siteRoot, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) return;
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  const actual = [...xml.matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>(?:[\s\S]*?<lastmod>([^<]+)<\/lastmod>)?[\s\S]*?<\/url>/g)]
    .map((match) => ({ loc: match[1], lastmod: match[2] || '' }));
  const newest = (items) => items.reduce((latest, item) => {
    const date = item.dateModified || item.date;
    return date > latest ? date : latest;
  }, '');
  const expected = [
    { href: '', date: newest(docs) },
    ...CATEGORY_REGISTRY.map((category) => ({
      href: `${category.directory}/`,
      date: newest(docs.filter((doc) => doc.category === category.key)),
    })),
    ...docs.map((doc) => ({ href: doc.normalizedHref, date: doc.dateModified || doc.date })),
  ].map((entry) => ({ loc: absolutePublicUrl(entry.href), lastmod: entry.date || '' }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push('sitemap.xml URLs do not match public content graph documents');
  }
}

function validateSite(options = {}) {
  const sourceRoot = path.resolve(options.projectRoot || projectRoot);
  const siteRoot = path.resolve(options.siteRoot || process.env.SITE_ROOT || path.join(sourceRoot, '_site'));
  const pagesBasePath = normalizePagesBasePath(options.pagesBasePath || process.env.PAGES_BASE_PATH || '/workplace/');
  const errors = [];
  const files = validateArtifactLayout(siteRoot, errors);
  if (!fs.existsSync(siteRoot)) return { errors, siteRoot, pagesBasePath };

  const htmlFiles = files.filter((filePath) => path.extname(filePath).toLowerCase() === '.html');
  const documents = new Map();
  htmlFiles.forEach((filePath) => {
    const record = parseHtml(filePath, siteRoot, errors);
    const ids = new Set(findElements(record.document, (node) => Boolean(getAttr(node, 'id')))
      .map((node) => getAttr(node, 'id')));
    documents.set(path.resolve(filePath), { ...record, ids });
  });

  const context = { documents, pagesBasePath, siteRoot };
  documents.forEach((record) => {
    validateDocumentStructure(record, siteRoot, errors);
    validateVisibleText(record, siteRoot, errors);
    validateReferences(record, context, errors);
  });

  validateArtifactParity(siteRoot, sourceRoot, errors);
  const content = readContentDocuments(sourceRoot, siteRoot, errors);
  validateMomOutputs(sourceRoot, siteRoot, content.momDocs, errors);
  validateStatementOutputs(sourceRoot, siteRoot, content.manualDocs, errors);
  validateContentIndexes(content, context, errors);
  if (content.graph && content.allDocs.length > 0) validateSitemap(content.listedDocs || content.allDocs, siteRoot, errors);

  return { errors, siteRoot, pagesBasePath };
}

function main() {
  const result = validateSite();
  if (result.errors.length > 0) {
    console.error(result.errors.join('\n'));
    process.exitCode = 1;
    return;
  }
  console.log(`Site validation passed for ${result.siteRoot} (Pages base ${result.pagesBasePath}).`);
}

if (require.main === module) main();

module.exports = {
  normalizePagesBasePath,
  parseSrcset,
  resolveReference,
  validateSite,
};
