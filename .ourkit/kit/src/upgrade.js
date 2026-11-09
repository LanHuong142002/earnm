// `upgrade`: replaces kit files with this package's version, without losing customizations (ADR 0007).
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  INSTALL_RECORD, hashFile, planFiles, removeLegacyGitignore, removeLegacyInstructions,
} = require('./install');
const { KIT_DIR, OVERRIDES_DIR, orphanOverrides } = require('./overrides');

// Kit files that live in the Host's own folders, and the Override folder for each.
const HOST_FOLDERS = [
  [path.join('.claude', 'skills'), 'stages'],
  [path.join('.claude', 'agents'), 'agents'],
  [path.join('.claude', 'rules'), 'rules'],
];
const toRecordPath = (p) => p.replace(/\\/g, '/');

// Where a hand edit to this kit file should move. Returns null when an Override can't
// apply, because the command's own code isn't resolved through Overrides.
function overridePathFor(target) {
  const normalized = path.normalize(target);
  for (const [dir, overrideFolder] of HOST_FOLDERS) {
    if (normalized.startsWith(dir + path.sep)) {
      return path.join(OVERRIDES_DIR, overrideFolder, path.relative(dir, normalized));
    }
  }
  const relative = path.relative(KIT_DIR, normalized);
  if (relative.startsWith(`bin${path.sep}`) || relative.startsWith(`src${path.sep}`)) return null;
  return path.join(OVERRIDES_DIR, relative);
}

function inspect(projectDir) {
  const recordFile = path.join(projectDir, INSTALL_RECORD);
  if (!fs.existsSync(recordFile)) return { error: `ourkit is not installed in ${projectDir}; run the Installer first` };
  const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
  const plan = planFiles(projectDir, record.roles, record.tracker);
  const planned = new Set(plan.map(({ target }) => toRecordPath(target)));

  const edited = Object.entries(record.files)
    .filter(([file, hash]) => {
      const absolute = path.join(projectDir, file);
      return fs.existsSync(absolute) && hashFile(absolute) !== hash;
    })
    .map(([file]) => file);
  const blocked = plan
    .map(({ target }) => toRecordPath(target))
    .filter((file) => !(file in record.files) && fs.existsSync(path.join(projectDir, file)));
  const conflicts = edited.filter((file) => {
    const override = overridePathFor(file);
    return override && fs.existsSync(path.join(projectDir, override));
  });
  const removed = Object.keys(record.files).filter((file) => !planned.has(file));
  return { record, plan, edited, blocked, conflicts, removed };
}

function moveToOverride(projectDir, file) {
  const destination = path.join(projectDir, overridePathFor(file));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.renameSync(path.join(projectDir, file), destination);
}

function removeEmptyParents(projectDir, file) {
  let dir = path.dirname(path.join(projectDir, file));
  while (dir !== projectDir && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
    dir = path.dirname(dir);
  }
}

function apply(projectDir, state, movable) {
  const { record, removed } = state;
  // Moving first means planFiles sees new Stage Overrides.
  for (const file of movable) moveToOverride(projectDir, file);
  const plan = planFiles(projectDir, record.roles, record.tracker);
  for (const file of removed) {
    const absolute = path.join(projectDir, file);
    if (fs.existsSync(absolute)) fs.rmSync(absolute);
    removeEmptyParents(projectDir, file);
  }
  const files = {};
  for (const { source, target } of plan) {
    const destination = path.join(projectDir, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    files[toRecordPath(target)] = hashFile(destination);
  }
  const movedInstructions = removeLegacyInstructions(projectDir);
  const unignored = removeLegacyGitignore(projectDir);
  const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const updated = { ...record, version, files };
  fs.writeFileSync(path.join(projectDir, INSTALL_RECORD), `${JSON.stringify(updated, null, 2)}\n`);
  return { previousVersion: record.version, version, count: plan.length, movedInstructions, unignored };
}

async function confirm(prompt) {
  const rl = readline.createInterface({ input: process.stdin });
  process.stdout.write(prompt);
  const { value, done } = await rl[Symbol.asyncIterator]().next();
  rl.close();
  return !done && /^y(es)?$/i.test(value.trim());
}

async function main(args) {
  const moveFlag = args.includes('--move-edits');
  const discardFlag = args.includes('--discard-edits');
  const projectArg = args.find((arg) => !arg.startsWith('--'));
  const projectDir = path.resolve(projectArg || process.cwd());
  const state = inspect(projectDir);
  if (state.error) {
    console.error(`ourkit: ${state.error}`);
    return 2;
  }
  const { edited, blocked, conflicts } = state;
  if (blocked.length > 0) {
    console.error(`ourkit: nothing was changed; these files are in the way: ${blocked.join(', ')}`);
    return 1;
  }
  if (conflicts.length > 0) {
    console.error(`ourkit: nothing was changed; these kit files were edited but already have an Override, so merge them by hand: ${conflicts.join(', ')}`);
    return 1;
  }
  const movable = edited.filter((file) => overridePathFor(file));
  const notMovable = edited.filter((file) => !overridePathFor(file));

  if (notMovable.length > 0 && !discardFlag) {
    console.error(`ourkit: nothing was changed; these are the kit's own code, which an Override can't customize: ${notMovable.join(', ')}`);
    console.error('ourkit: copy any changes you need elsewhere, then rerun with --discard-edits');
    return 1;
  }
  let toMove = movable;
  if (movable.length > 0 && !moveFlag) {
    if (discardFlag) {
      toMove = [];
    } else {
      console.log(`ourkit: these kit files were edited by hand:\n${movable.map((file) => `  ${file}`).join('\n')}`);
      const yes = await confirm('Move these edits to Overrides so they are kept? [y/N] ');
      if (!yes) {
        console.error('ourkit: nothing was changed');
        return 1;
      }
    }
  }
  const { previousVersion, version, count, movedInstructions, unignored } = apply(projectDir, state, toMove);
  for (const file of toMove) console.log(`ourkit: moved ${file} to ${toRecordPath(overridePathFor(file))}`);
  console.log(`ourkit: upgraded ${previousVersion} to ${version} (${count} files)`);
  if (movedInstructions) console.log('ourkit: moved the kit\'s block out of CLAUDE.md into .claude/rules/ourkit.md');
  if (unignored) console.log('ourkit: removed the kit\'s block from .gitignore; commit the kit\'s files, so a teammate needs nothing after cloning');
  for (const relative of orphanOverrides(projectDir)) {
    console.log(`ourkit: warning: ${toRecordPath(path.join(OVERRIDES_DIR, relative))} no longer matches a kit file, so it has no effect`);
  }
  return 0;
}

module.exports = { main, overridePathFor };
