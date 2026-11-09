// Tracker Packs: installing one, and linking the Active Change to its ticket.
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { readChange, updateChange } = require('./change-state');
const { INSTALL_RECORD, KIT_ROOT, copyPlanned, trackerPlan } = require('./install');

function addPack(name, projectArg) {
  if (!name) {
    console.error('usage: ourkit tracker add <name> [project-dir]');
    return 2;
  }
  const available = fs.readdirSync(path.join(KIT_ROOT, 'tracker-packs'));
  if (!available.includes(name)) {
    console.error(`ourkit: no Tracker Pack named ${name}; available: ${available.join(', ')}`);
    return 2;
  }
  const projectDir = path.resolve(projectArg || process.cwd());
  const recordFile = path.join(projectDir, INSTALL_RECORD);
  if (!fs.existsSync(recordFile)) {
    console.error(`ourkit: ourkit is not installed in ${projectDir}; run the Installer first`);
    return 2;
  }
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  if (record.tracker) {
    console.error(`ourkit: the ${record.tracker} Tracker Pack is already installed`);
    return 1;
  }
  const plan = trackerPlan(name);
  const inTheWay = plan.filter(({ target }) => fs.existsSync(path.join(projectDir, target)));
  if (inTheWay.length > 0) {
    console.error(`ourkit: nothing was changed; these files are in the way: ${inTheWay.map(({ target }) => target.replace(/\\/g, '/')).join(', ')}`);
    return 1;
  }
  const files = copyPlanned(projectDir, plan);
  const updated = { ...record, tracker: name, files: { ...record.files, ...files } };
  fs.writeFileSync(recordFile, `${JSON.stringify(updated, null, 2)}\n`);
  console.log(`ourkit: installed the ${name} Tracker Pack`);
  return 0;
}

function installedPack(projectDir) {
  const recordFile = path.join(projectDir, INSTALL_RECORD);
  if (!fs.existsSync(recordFile)) return null;
  return JSON.parse(fs.readFileSync(recordFile, 'utf8')).tracker || null;
}

function main(args) {
  const [action, value, projectArg] = args;
  if (action === 'add') return addPack(value, projectArg);

  const projectDir = process.cwd();
  const pack = installedPack(projectDir);
  if (action === 'status') {
    const change = activeChange(projectDir);
    const ticket = change.error ? null : readChange(projectDir, change.id).ticket || null;
    const operations = pack ? `.ourkit/kit/tracker-packs/${pack}/operations.md` : null;
    console.log(JSON.stringify({ pack, operations, ticket }, null, 2));
    return 0;
  }
  if (action === 'link' && value && value.trim()) {
    const change = activeChange(projectDir);
    if (change.error) {
      console.error(`ourkit: no Active Change: ${change.error}`);
      return 1;
    }
    updateChange(projectDir, change.id, { ticket: value.trim() });
    console.log(`ourkit: this change works on ticket ${value.trim()}`);
    return 0;
  }
  console.error('usage: ourkit tracker <status | link <ticket> | add <name> [project-dir]>');
  return 2;
}

module.exports = { main };
