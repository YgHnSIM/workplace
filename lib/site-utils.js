const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function escapeNoBreakHtml(value) {
  return escapeHtml(value).replace(/\s+/g, '&nbsp;');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function toPosixPath(value) {
  return String(value).replace(/\\/g, '/');
}

function relativeTo(rootDir, filePath) {
  return toPosixPath(path.relative(rootDir, filePath));
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeTextFile(filePath, content) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
}

function isExternalRef(ref) {
  return /^(https?:|mailto:|tel:|#)/i.test(ref);
}

function walkFiles(dir, options = {}) {
  const ignoredDirs = options.ignoredDirs || new Set();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  entries.forEach((entry) => {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) return;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, options));
      return;
    }

    if (entry.isFile()) files.push(fullPath);
  });

  return files;
}

module.exports = {
  escapeAttr,
  escapeHtml,
  escapeNoBreakHtml,
  isExternalRef,
  readJson,
  relativeTo,
  toPosixPath,
  walkFiles,
  writeTextFile,
};
