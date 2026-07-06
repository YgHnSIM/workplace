const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const ignoredDirs = new Set(['.git', '~', '_source']);
const errors = [];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  entries.forEach((entry) => {
    if (ignoredDirs.has(entry.name)) return;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    if (entry.isFile()) files.push(fullPath);
  });
  return files;
}

function isExternalRef(ref) {
  return /^(https?:|mailto:|tel:|#|javascript:)/i.test(ref);
}

function validateRefs(filePath, html) {
  const refPattern = /\b(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = refPattern.exec(html)) !== null) {
    const ref = match[1];
    if (!ref || isExternalRef(ref)) continue;

    const cleanRef = ref.split('#')[0].split('?')[0];
    if (!cleanRef) continue;

    const resolved = path.resolve(path.dirname(filePath), cleanRef);
    if (!fs.existsSync(resolved)) {
      errors.push(`${path.relative(rootDir, filePath)} references missing file: ${ref}`);
    }
  }
}

function validatePlaceholders(filePath, html) {
  const relative = path.relative(rootDir, filePath);
  const badPatterns = [
    { pattern: /\?\?/, label: 'placeholder ??' },
    { pattern: /TODO|FIXME/i, label: 'TODO/FIXME marker' },
    { pattern: /2026년\s+월\s+일/, label: 'empty Korean date' },
    { pattern: /\\text|\\next|\bext\b/, label: 'broken copy-text marker' },
  ];

  badPatterns.forEach(({ pattern, label }) => {
    if (pattern.test(html)) errors.push(`${relative} contains ${label}`);
  });
}

function validatePublicMomSources() {
  const publicMarkdown = walk(path.join(rootDir, 'MoM')).filter((file) => path.extname(file).toLowerCase() === '.md');
  publicMarkdown.forEach((file) => {
    errors.push(`public MoM directory contains raw markdown: ${path.relative(rootDir, file)}`);
  });
}

function validateMomIndex() {
  const momDir = path.join(rootDir, 'MoM');
  const indexPath = path.join(momDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    errors.push('MoM/index.html is missing');
    return;
  }

  const index = fs.readFileSync(indexPath, 'utf8');
  fs.readdirSync(momDir)
    .filter((file) => /^\d{6}\.html$/.test(file))
    .forEach((file) => {
      if (!index.includes(`href="${file}"`)) {
        errors.push(`MoM/index.html does not link ${file}`);
      }
    });
}

function validatePublicPrivacy() {
  const publicDir = path.join(rootDir, 'MoM');
  if (!fs.existsSync(publicDir)) return;

  fs.readdirSync(publicDir)
    .filter((file) => /^\d{6}\.html$/.test(file))
    .forEach((file) => {
      const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
      const rowPattern = /<tr>\s*<td>(?:<strong>)?(참석자?|참관)(?:<\/strong>)?<\/td>\s*<td>(.*?)<\/td>\s*<\/tr>/gs;
      let match;
      while ((match = rowPattern.exec(html)) !== null) {
        if (!match[2].includes('세부 명단 비공개')) {
          errors.push(`${path.join('MoM', file)} exposes ${match[1]} list`);
        }
      }
    });
}

function main() {
  walk(rootDir)
    .filter((file) => path.extname(file).toLowerCase() === '.html')
    .forEach((file) => {
      const html = fs.readFileSync(file, 'utf8');
      validateRefs(file, html);
      validatePlaceholders(file, html);
    });

  validatePublicMomSources();
  validateMomIndex();
  validatePublicPrivacy();

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }

  console.log('Site validation passed.');
}

main();
