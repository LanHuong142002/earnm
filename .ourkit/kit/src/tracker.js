// Tracker Packs: installing one, choosing where progress shows, and linking the Active Change to its ticket.
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { readChange, updateChange } = require('./change-state');
const { INSTALL_RECORD, KIT_ROOT, copyPlanned, trackerPlan } = require('./install');
const { select } = require('./menu');

// The project's own Tracker settings. The kit never overwrites them, and upgrade leaves them alone.
const TRACKER_SETTINGS = path.join('.ourkit', 'tracker.json');
const PROGRESS = ['labels', 'project', 'both'];
const PROGRESS_CHOICES = [
  { label: 'Labels on the issue (ourkit:in-progress, ourkit:in-review, ourkit:blocked)', answer: 'labels' },
  { label: 'Status column on a GitHub Project board', answer: 'project' },
  { label: 'Both', answer: 'both' },
];
const STATUSES = ['in-progress', 'in-review', 'blocked'];
const USAGE = `usage: ourkit tracker <status
  | link <ticket>
  | add <name> [project-dir] [--progress labels|project|both]
  | progress <labels|project|both>
  | board <owner> <number> [--field <name>] [--in-progress <column>] [--in-review <column>] [--blocked <column>]>`;

function readSettings(projectDir) {
  const file = path.join(projectDir, TRACKER_SETTINGS);
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { invalid: true };
  }
}

function writeSettings(projectDir, settings) {
  const file = path.join(projectDir, TRACKER_SETTINGS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

// Splits `--flag value` pairs from the other arguments.
function parseFlags(args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith('--')) {
      flags[args[i].slice(2)] = args[i + 1];
      i += 1;
    } else {
      rest.push(args[i]);
    }
  }
  return { flags, rest };
}

async function chooseProgress(given) {
  if (given !== undefined) return PROGRESS.includes(given) ? given : null;
  if (!(process.stdin.isTTY && process.stdout.isTTY)) return 'labels';
  const chosen = await select('Where should ticket progress show?', PROGRESS_CHOICES.map(({ label }) => label));
  return chosen === null ? null : PROGRESS_CHOICES[chosen].answer;
}

async function addPack(args) {
  const { flags, rest } = parseFlags(args);
  const [name, projectArg] = rest;
  if (!name) {
    console.error(USAGE);
    return 2;
  }
  if (flags.progress !== undefined && !PROGRESS.includes(flags.progress)) {
    console.error(`ourkit: --progress must be one of ${PROGRESS.join(', ')}`);
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
  const progress = await chooseProgress(flags.progress);
  if (progress === null) {
    console.error('ourkit: cancelled; nothing was changed');
    return 2;
  }
  const files = copyPlanned(projectDir, plan);
  const updated = { ...record, tracker: name, files: { ...record.files, ...files } };
  fs.writeFileSync(recordFile, `${JSON.stringify(updated, null, 2)}\n`);
  writeSettings(projectDir, { ...readSettings(projectDir), progress });
  console.log(`ourkit: installed the ${name} Tracker Pack; progress shows with ${progress}`);
  if (progress !== 'labels') {
    console.log('ourkit: GitHub Projects need the project scope: run `gh auth refresh -s project` once');
    console.log('ourkit: the agent picks the board with you the first time it updates a ticket');
  }
  console.log(`ourkit: commit ${TRACKER_SETTINGS.replace(/\\/g, '/')} so the team shares it`);
  return 0;
}

function setProgress(projectDir, value) {
  if (!PROGRESS.includes(value)) {
    console.error(`ourkit: progress must be one of ${PROGRESS.join(', ')}`);
    return 2;
  }
  const settings = readSettings(projectDir);
  if (settings.invalid) {
    console.error(`ourkit: ${TRACKER_SETTINGS} isn't valid JSON; fix or delete it first`);
    return 1;
  }
  writeSettings(projectDir, { ...settings, progress: value });
  console.log(`ourkit: ticket progress now shows with ${value}`);
  return 0;
}

function setBoard(projectDir, args) {
  const { flags, rest } = parseFlags(args);
  const [owner, numberText] = rest;
  const number = Number(numberText);
  if (!owner || !Number.isInteger(number) || number < 1) {
    console.error(USAGE);
    return 2;
  }
  const settings = readSettings(projectDir);
  if (settings.invalid) {
    console.error(`ourkit: ${TRACKER_SETTINGS} isn't valid JSON; fix or delete it first`);
    return 1;
  }
  const columns = Object.fromEntries(STATUSES.map((status) => [status, flags[status] || null]));
  const board = { owner, number, field: flags.field || 'Status', columns };
  writeSettings(projectDir, { ...settings, board });
  const missing = STATUSES.filter((status) => !columns[status]);
  console.log(`ourkit: tickets move on project ${number} of ${owner}, in its ${board.field} field`);
  if (missing.length > 0) console.log(`ourkit: no column for ${missing.join(', ')}, so those statuses don't move the card`);
  return 0;
}

function installedPack(projectDir) {
  const recordFile = path.join(projectDir, INSTALL_RECORD);
  if (!fs.existsSync(recordFile)) return null;
  return JSON.parse(fs.readFileSync(recordFile, 'utf8')).tracker || null;
}

function status(projectDir) {
  const pack = installedPack(projectDir);
  const change = activeChange(projectDir);
  const ticket = change.error ? null : readChange(projectDir, change.id).ticket || null;
  const operations = pack ? `.ourkit/kit/tracker-packs/${pack}/operations.md` : null;
  const settings = pack ? readSettings(projectDir) : {};
  const result = {
    pack,
    operations,
    ticket,
    progress: pack ? (PROGRESS.includes(settings.progress) ? settings.progress : 'labels') : null,
    board: settings.board || null,
  };
  if (settings.invalid) result.problem = `${TRACKER_SETTINGS} isn't valid JSON, so progress falls back to labels`;
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

function main(args) {
  const [action, value] = args;
  if (action === 'add') return addPack(args.slice(1));

  const projectDir = process.cwd();
  if (action === 'status') return status(projectDir);
  if (action === 'progress' && value) return setProgress(projectDir, value);
  if (action === 'board') return setBoard(projectDir, args.slice(1));
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
  console.error(USAGE);
  return 2;
}

module.exports = { TRACKER_SETTINGS, main };
