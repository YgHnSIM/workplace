const { spawnSync } = require('child_process');

const generatedPaths = [
  'index.html',
  'MoM',
  'knowledge/index.html',
  'notice/index.html',
  'robots.txt',
  'sitemap.xml',
];

function runGit(args, cwd) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error((result.stderr || result.stdout || `git exited with ${result.status}`).trim());
  }
  return result;
}

function verifyGeneratedFiles(options = {}) {
  const cwd = options.cwd || require('path').join(__dirname, '..');
  const paths = options.generatedPaths || generatedPaths;
  const changed = runGit(['diff', '--name-only', '--', ...paths], cwd).stdout.trim();
  const untracked = runGit([
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    ...paths,
  ], cwd).stdout.trim();
  const drift = [...new Set([...changed.split(/\r?\n/), ...untracked.split(/\r?\n/)].filter(Boolean))];
  if (drift.length > 0) {
    throw new Error(`Generated public files are out of date:\n${drift.map((file) => `- ${file}`).join('\n')}\nRun npm run build and commit the results.`);
  }
}

if (require.main === module) {
  try {
    verifyGeneratedFiles();
    console.log('Generated public files match the committed build.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyGeneratedFiles };
