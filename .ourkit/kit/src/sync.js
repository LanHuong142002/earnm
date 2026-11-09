// `sync`: rebuilds the files the kit copied from the install record, with Overrides applied.
// It restores deleted copies and applies an Override without waiting for an upgrade.
const fs = require('fs');
const path = require('path');
const {
  INSTALL_RECORD, copyPlanned, hashFile, kitVersion, planFiles, syncCommand,
} = require('./install');

const toRecordPath = (p) => p.replace(/\\/g, '/');

// A file is a hand edit only if it matches nothing the kit could have put there: the recorded
// copy, the kit's own file, or the Override about to replace it. An Override added on another
// machine changes the record, so the kit's own file must count as unedited too.
function handEdits(projectDir, record, plan) {
  return plan
    .filter(({ target }) => fs.existsSync(path.join(projectDir, target)))
    .filter(({ source, original, target }) => {
      const current = hashFile(path.join(projectDir, target));
      return current !== record.files[toRecordPath(target)] && current !== hashFile(original) && current !== hashFile(source);
    })
    .map(({ target }) => toRecordPath(target));
}

function sync(projectDir) {
  const recordFile = path.join(projectDir, INSTALL_RECORD);
  if (!fs.existsSync(recordFile)) return { code: 2, error: `ourkit is not installed in ${projectDir}; run the Installer first` };
  const text = fs.readFileSync(recordFile, 'utf8');
  const record = JSON.parse(text);
  const version = kitVersion();
  if (record.version !== version) {
    return { code: 1, error: `this project uses ourkit ${record.version}, but this is ${version}; run: ${syncCommand(record.version)}` };
  }
  const plan = planFiles(projectDir, record.roles, record.tracker);
  const edited = handEdits(projectDir, record, plan);
  if (edited.length > 0) {
    return {
      code: 1,
      error: `nothing was changed; these kit files were edited by hand: ${edited.join(', ')}. Move each edit to its Override in .ourkit/overrides, or delete the file, then run sync again`,
    };
  }
  const files = copyPlanned(projectDir, plan);
  // Written only when an Override changed something, so a plain sync leaves git clean.
  const updated = `${JSON.stringify({ ...record, files }, null, 2)}\n`;
  if (updated.replace(/\r\n/g, '\n') !== text.replace(/\r\n/g, '\n')) fs.writeFileSync(recordFile, updated);
  return { code: 0, count: plan.length, version: record.version };
}

function main(args) {
  const projectDir = path.resolve(args.find((arg) => !arg.startsWith('--')) || process.cwd());
  const result = sync(projectDir);
  if (result.error) {
    console.error(`ourkit: ${result.error}`);
    return result.code;
  }
  console.log(`ourkit: synced ${result.count} files (ourkit ${result.version})`);
  return 0;
}

module.exports = { main, sync };
