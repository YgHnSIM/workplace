const fs = require('fs');
const path = require('path');

function assertOutputPath(projectRoot, outputPath) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(outputPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Build output must stay inside the project root: ${outputPath}`);
  }
}

function mergeOutputMaps(...maps) {
  const output = new Map();
  maps.forEach((map) => {
    if (!(map instanceof Map)) throw new TypeError('Renderer output must be a Map<outputPath, content>');
    map.forEach((content, outputPath) => {
      const key = path.resolve(outputPath);
      if (output.has(key)) throw new Error(`Duplicate build output path: ${outputPath}`);
      output.set(key, String(content));
    });
  });
  return output;
}

function writeOutputMap(outputMap, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  if (!(outputMap instanceof Map)) throw new TypeError('Output must be a Map<outputPath, content>');
  outputMap.forEach((content, outputPath) => {
    assertOutputPath(projectRoot, outputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  });
  outputMap.forEach((content, outputPath) => {
    fs.writeFileSync(outputPath, content, 'utf8');
  });
  return outputMap.size;
}

module.exports = {
  assertOutputPath,
  mergeOutputMaps,
  writeOutputMap,
};
