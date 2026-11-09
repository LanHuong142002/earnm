// Records the kit keeps about one change, stored under the Active Change's id.
const fs = require('fs');
const path = require('path');

const CHANGES_DIR = path.join('.ourkit', 'changes');

// Branch names can hold slashes, which mustn't become folders.
const fileFor = (projectDir, id) =>
  path.join(projectDir, CHANGES_DIR, `${id.replace(/[^A-Za-z0-9._-]/g, '-')}.json`);

function readChange(projectDir, id) {
  const file = fileFor(projectDir, id);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function updateChange(projectDir, id, fields) {
  const file = fileFor(projectDir, id);
  const updated = { ...readChange(projectDir, id), ...fields };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`);
  return updated;
}

module.exports = { CHANGES_DIR, readChange, updateChange };
