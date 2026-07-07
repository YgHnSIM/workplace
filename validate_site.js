const fs = require('fs');
const path = require('path');
const {
  isExternalRef,
  relativeTo,
  toPosixPath,
  walkFiles,
} = require('./lib/site-utils');

const rootDir = __dirname;
const ignoredDirs = new Set(['.git', '~', '_source', 'node_modules']);
const errors = [];

function validateRefs(filePath, html) {
  const refPattern = /\b(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = refPattern.exec(html)) !== null) {
    const ref = match[1];
    if (!ref) continue;
    if (/^javascript:/i.test(ref)) {
      errors.push(`${relativeTo(rootDir, filePath)} contains unsafe javascript URL: ${ref}`);
      continue;
    }
    if (ref.startsWith('//')) {
      errors.push(`${relativeTo(rootDir, filePath)} contains protocol-relative URL: ${ref}`);
      continue;
    }
    if (isExternalRef(ref)) continue;

    const cleanRef = ref.split('#')[0].split('?')[0];
    if (!cleanRef) continue;

    if (/^[a-z][a-z0-9+.-]*:/i.test(cleanRef)) {
      errors.push(`${relativeTo(rootDir, filePath)} contains unsupported URL protocol: ${ref}`);
      continue;
    }

    const resolved = cleanRef.startsWith('/')
      ? path.resolve(rootDir, `.${cleanRef}`)
      : path.resolve(path.dirname(filePath), cleanRef);
    const rootWithSep = `${rootDir}${path.sep}`;

    if (resolved !== rootDir && !resolved.startsWith(rootWithSep)) {
      errors.push(`${relativeTo(rootDir, filePath)} references file outside site root: ${ref}`);
      continue;
    }

    if (!fs.existsSync(resolved)) {
      errors.push(`${relativeTo(rootDir, filePath)} references missing file: ${ref}`);
    }
  }
}

function validatePlaceholders(filePath, html) {
  const relative = relativeTo(rootDir, filePath);
  const badPatterns = [
    { pattern: /\?\?/, label: 'placeholder ??' },
    { pattern: /TODO|FIXME/i, label: 'TODO/FIXME marker' },
    { pattern: /2026년\s+월\s+일/, label: 'empty Korean date' },
    { pattern: /\\text|\\next|\bext\b/, label: 'broken copy-text marker' },
    { pattern: /공개용 요약본|요약본만|회의 개요·주요 결정사항·차기 회의 안내만|민감 의결 자료/, label: 'outdated limited-disclosure policy text' },
  ];

  badPatterns.forEach(({ pattern, label }) => {
    if (pattern.test(html)) errors.push(`${relative} contains ${label}`);
  });
}

function validateProjectText() {
  ['README.md'].forEach((file) => {
    const filePath = path.join(rootDir, file);
    if (!fs.existsSync(filePath)) return;
    const text = fs.readFileSync(filePath, 'utf8');
    if (/공개용 요약본|요약본만|회의 개요·주요 결정사항·차기 회의 안내만|민감 의결 자료/.test(text)) {
      errors.push(`${file} contains outdated limited-disclosure policy text`);
    }
  });
}

function validatePublicMomSources() {
  const publicMarkdown = walkFiles(path.join(rootDir, 'MoM'), { ignoredDirs })
    .filter((file) => path.extname(file).toLowerCase() === '.md');
  publicMarkdown.forEach((file) => {
    errors.push(`public MoM directory contains raw markdown: ${relativeTo(rootDir, file)}`);
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

function validateNoRedactedMomAttendees() {
  const publicDir = path.join(rootDir, 'MoM');
  if (!fs.existsSync(publicDir)) return;

  fs.readdirSync(publicDir)
    .filter((file) => /^\d{6}\.html$/.test(file))
    .forEach((file) => {
      const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
      const rowPattern = /<tr>\s*<td>(?:<strong>)?(참석자?|참관)(?:<\/strong>)?<\/td>\s*<td>(.*?)<\/td>\s*<\/tr>/gs;
      let match;
      while ((match = rowPattern.exec(html)) !== null) {
        if (match[2].includes('세부 명단 비공개')) {
          errors.push(`${toPosixPath(path.join('MoM', file))} contains redacted ${match[1]} list`);
        }
      }
    });
}

function validateRemovedFiles() {
  [
    path.join(rootDir, 'knowledge', 'test.html'),
    path.join(rootDir, 'notice', 'test.html'),
  ].forEach((file) => {
    if (fs.existsSync(file)) {
      errors.push(`${relativeTo(rootDir, file)} should be removed from the public site`);
    }
  });
}

function main() {
  walkFiles(rootDir, { ignoredDirs })
    .filter((file) => path.extname(file).toLowerCase() === '.html')
    .forEach((file) => {
      const html = fs.readFileSync(file, 'utf8');
      validateRefs(file, html);
      validatePlaceholders(file, html);
    });

  validateProjectText();
  validateRemovedFiles();
  validatePublicMomSources();
  validateMomIndex();
  validateNoRedactedMomAttendees();

  if (errors.length > 0) {
    console.error(errors.join('\n'));
    process.exit(1);
  }

  console.log('Site validation passed.');
}

main();
