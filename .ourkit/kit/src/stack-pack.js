// Installs an optional Stack Pack. Once installed, rule layering loads it (src/rules.js).
const fs = require('fs');
const path = require('path');
const { checkStackPack } = require('./contract-check');
const { KIT_DIR } = require('./rules');

function installStackPack(source, projectDir) {
  const parent = path.dirname(source);
  const name = path.basename(source);
  const problems = checkStackPack(parent, name);
  if (problems.length > 0) return { installed: false, problems };

  const target = path.join(projectDir, KIT_DIR, 'stack-packs', name);
  if (fs.existsSync(target)) {
    return {
      installed: false,
      problems: [{ file: path.relative(projectDir, target), contract: 'Stack Pack', message: 'is already installed' }],
    };
  }
  fs.cpSync(source, target, { recursive: true });
  return { installed: true, name, problems: [] };
}

function main(subcommand, sourceArg, projectArg) {
  if (subcommand !== 'add' || !sourceArg) {
    console.error('usage: ourkit pack add <pack-folder> [project-dir]');
    return 2;
  }
  const source = path.resolve(sourceArg);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    console.error(`ourkit: no Stack Pack folder at ${source}`);
    return 2;
  }
  const result = installStackPack(source, path.resolve(projectArg || process.cwd()));
  for (const { file, contract, message } of result.problems) {
    console.error(`${file.replace(/\\/g, '/')}: [${contract}] ${message}`);
  }
  if (!result.installed) return 1;
  console.log(`ourkit: installed Stack Pack ${result.name}`);
  return 0;
}

module.exports = { installStackPack, main };
