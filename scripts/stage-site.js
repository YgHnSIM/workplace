const fs = require('fs');
const path = require('path');

const PUBLIC_DIRECTORIES = Object.freeze([
  'assets',
  'MoM',
  'statement',
  'knowledge',
  'notice',
]);

const PUBLIC_ROOT_FILES = Object.freeze([
  'index.html',
  '.nojekyll',
  'robots.txt',
  'sitemap.xml',
]);

function isAllowedRootFile(name) {
  return PUBLIC_ROOT_FILES.includes(name);
}

function assertSafeOutputDirectory(projectRoot, outputDir) {
  const root = path.resolve(projectRoot);
  const output = path.resolve(outputDir);
  const relative = path.relative(root, output);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Staging directory must be a child of the project root: ${output}`);
  }

  if (path.basename(output) !== '_site') {
    throw new Error(`Staging directory must be named _site: ${output}`);
  }

  if (output === path.parse(output).root) {
    throw new Error(`Refusing to use a filesystem root as the staging directory: ${output}`);
  }
}

function copyEntry(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new Error(`Public site entries must not be symbolic links: ${source}`);
  }

  fs.cpSync(source, destination, {
    recursive: stat.isDirectory(),
    errorOnExist: false,
    force: true,
    dereference: false,
  });
}

function stageSite(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..'));
  const outputDir = path.resolve(options.outputDir || path.join(projectRoot, '_site'));
  assertSafeOutputDirectory(projectRoot, outputDir);

  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const rootEntries = fs.readdirSync(projectRoot, { withFileTypes: true });
  const selectedRootFiles = rootEntries
    .filter((entry) => entry.isFile() && isAllowedRootFile(entry.name))
    .map((entry) => entry.name);

  ['index.html', 'robots.txt', 'sitemap.xml'].forEach((name) => {
    if (!selectedRootFiles.includes(name)) {
      throw new Error(`Cannot stage the site because ${name} is missing.`);
    }
  });

  selectedRootFiles.forEach((name) => {
    copyEntry(path.join(projectRoot, name), path.join(outputDir, name));
  });

  if (!selectedRootFiles.includes('.nojekyll')) {
    fs.writeFileSync(path.join(outputDir, '.nojekyll'), '', 'utf8');
  }

  PUBLIC_DIRECTORIES.forEach((name) => {
    const source = path.join(projectRoot, name);
    if (!fs.existsSync(source)) {
      throw new Error(`Required public directory is missing: ${name}`);
    }
    copyEntry(source, path.join(outputDir, name));
  });

  return {
    outputDir,
    rootFiles: fs.readdirSync(outputDir).sort(),
  };
}

if (require.main === module) {
  try {
    const result = stageSite();
    console.log(`Prepared clean Pages artifact at ${result.outputDir}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  PUBLIC_DIRECTORIES,
  PUBLIC_ROOT_FILES,
  isAllowedRootFile,
  stageSite,
};
