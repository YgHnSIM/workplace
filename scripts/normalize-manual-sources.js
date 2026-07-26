const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceDirectories = [
  path.join(projectRoot, '_source', 'knowledge'),
  path.join(projectRoot, '_source', 'notice'),
];

function normalizeSource(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const head = source.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (!head || !body) throw new Error(`${filePath} must be a complete HTML document`);
  const styles = [...head[1].matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)]
    .map((match) => match[0].trim())
    .join('\n');
  const lang = source.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1] || 'ko';
  const pageStyle = styles ? `\n\n<!-- page-style:start -->\n${styles}\n<!-- page-style:end -->` : '';
  return `<!DOCTYPE html>\n<html lang="${lang}">\n\n<head>\n  <!-- seo-head:start -->\n  <!-- seo-head:end -->${pageStyle}\n</head>\n\n<body>\n${body[1].trim()}\n</body>\n\n</html>\n`;
}

sourceDirectories.forEach((directory) => {
  fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .forEach((entry) => {
      const filePath = path.join(directory, entry.name);
      fs.writeFileSync(filePath, normalizeSource(filePath), 'utf8');
      console.log(`Normalized ${path.relative(projectRoot, filePath).replace(/\\/g, '/')}`);
    });
});
