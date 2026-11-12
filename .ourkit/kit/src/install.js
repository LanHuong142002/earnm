// Installer: asks its questions, copies the kit and records what it did.
// Deterministic by design (ADR 0005): inference is left to Init. What it copies is committed,
// so a teammate needs nothing after cloning (ADR 0014).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { select } = require('./menu');
const { OVERRIDES_DIR } = require('./overrides');

const KIT_ROOT = path.join(__dirname, '..');
const KIT_DIR = path.join('.ourkit', 'kit');
const INSTALL_RECORD = path.join('.ourkit', 'install.json');
const HOST = 'claude-code';
// The answers people type, and the entry each one records. The glossary's terms are accepted too.
const ENTRY_ANSWERS = { new: 'greenfield', existing: 'brownfield', greenfield: 'greenfield', brownfield: 'brownfield' };
// Files whose presence hints at a stack. Only presence is recorded; Init does the understanding.
const STACK_MARKERS = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'go.mod', 'Cargo.toml', 'pom.xml',
  'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'Makefile', 'Dockerfile',
];
const NOT_PROJECT_CODE = ['.git', '.ourkit', '.claude'];
// Read when needed: the copy of the kit inside a project has no package.json.
const kitVersion = () => JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8')).version;
const REPO = 'github:LanHuong142002/ourkit';
// Marked blocks older versions wrote into the project's own files, which `upgrade` now removes:
// the routing in CLAUDE.md (before ADR 0014), and the .gitignore block of 0.2.0.
const LEGACY_BLOCKS = {
  instructions: { file: 'CLAUDE.md', start: '<!-- ourkit:start', end: '<!-- ourkit:end -->' },
  gitignore: { file: '.gitignore', start: '# ourkit:start', end: '# ourkit:end' },
};

const toRecordPath = (p) => p.replace(/\\/g, '/');
// Pinned to the project's version, so every machine rebuilds the same kit.
const syncCommand = (version) => `npx ${REPO}#v${version} sync`;

// Line endings are normalized because git can change them per machine, which must not
// look like a hand edit to `upgrade`.
function hashFile(file) {
  const content = fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(content, 'latin1').digest('hex');
}

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

function availableRoles() {
  return fs.readdirSync(path.join(KIT_ROOT, 'roles')).sort();
}

// Returns the Roles selected by a comma-separated answer, or an error message.
function parseRoles(answer) {
  const names = answer.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean);
  const expanded = names.flatMap((name) => {
    if (name === 'none') return [];
    return name === 'full-stack' || name === 'fullstack' ? ['frontend', 'backend'] : [name];
  });
  const unknown = expanded.filter((name) => !availableRoles().includes(name));
  if (unknown.length > 0) return { error: `unknown Role: ${unknown.join(', ')}` };
  return { roles: [...new Set(expanded)].sort() };
}

function parseEntry(answer) {
  const entry = ENTRY_ANSWERS[answer.trim().toLowerCase()];
  return entry ? { entry } : { error: 'answer new or existing' };
}

// The Role menu: each Role alone, both for Full-stack, or none. Answers are typed as parseRoles reads them.
function roleChoices() {
  const roles = availableRoles();
  const choices = roles.map((role) => ({ label: role[0].toUpperCase() + role.slice(1), answer: role }));
  if (roles.includes('frontend') && roles.includes('backend')) {
    choices.push({ label: 'Full-stack (frontend and backend)', answer: 'full-stack' });
  }
  return [...choices, { label: 'None', answer: 'none' }];
}

function hasProjectCode(projectDir) {
  return fs.readdirSync(projectDir).some((name) => !NOT_PROJECT_CODE.includes(name));
}

function readShell() {
  return JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'hosts', HOST, 'shell.json'), 'utf8'));
}

function trackerPlan(name) {
  const root = path.join(KIT_ROOT, 'tracker-packs', name);
  return filesUnder(root).map((source) => ({
    source,
    original: source,
    target: path.join(KIT_DIR, 'tracker-packs', name, path.relative(root, source)),
  }));
}

// Copies files into the project, returning their hashes for the install record.
function copyPlanned(projectDir, plan) {
  const files = {};
  for (const { source, target } of plan) {
    const destination = path.join(projectDir, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    files[toRecordPath(target)] = hashFile(destination);
  }
  return files;
}

// Every file the kit puts in a project, as { source, original, target } with target relative to the
// project. `source` is what gets copied, an Override when there is one; `original` is the kit's own file.
function planFiles(projectDir, roles, tracker) {
  const shell = readShell();
  const plan = [];
  const add = (from, toDir) => {
    for (const source of filesUnder(path.join(KIT_ROOT, from))) {
      plan.push({ source, original: source, target: path.join(toDir, path.relative(path.join(KIT_ROOT, from), source)) });
    }
  };
  add('core', path.join(KIT_DIR, 'core'));
  add('bin', path.join(KIT_DIR, 'bin'));
  add('src', path.join(KIT_DIR, 'src'));
  // What a Loop Run needs to start a fresh session on this Host.
  for (const file of ['shell.json', 'session-settings.json']) {
    const override = path.join(projectDir, OVERRIDES_DIR, 'host', file);
    const original = path.join(KIT_ROOT, 'hosts', HOST, file);
    plan.push({
      source: fs.existsSync(override) ? override : original,
      original,
      target: path.join(KIT_DIR, 'host', file),
    });
  }
  for (const role of roles) add(path.join('roles', role), path.join(KIT_DIR, 'roles', role));
  if (tracker) plan.push(...trackerPlan(tracker));
  // The Host reads these directly from its own folders, so their Overrides are applied here.
  const addForHost = (root, overrideFolder, toDir) => {
    for (const source of filesUnder(root)) {
      const relative = path.relative(root, source);
      const override = path.join(projectDir, OVERRIDES_DIR, overrideFolder, relative);
      plan.push({
        source: fs.existsSync(override) ? override : source,
        original: source,
        target: path.join(toDir, relative),
      });
    }
  };
  addForHost(path.join(KIT_ROOT, 'stages'), 'stages', shell.stagesDir);
  addForHost(path.join(KIT_ROOT, 'hosts', HOST, 'agents'), 'agents', shell.agentsDir);
  // The Host loads these in every session. Without them a plain request never reaches the
  // lifecycle, so no Tier, Gate or Sensitive Area floor applies (ADR 0013).
  addForHost(path.join(KIT_ROOT, 'hosts', HOST, 'rules'), 'rules', shell.rulesDir);
  return plan;
}

// Removes a marked block an older version wrote into one of the project's files, and the file too
// if nothing else is in it. Returns whether anything was removed.
function removeLegacyBlock(projectDir, { file: name, start: startMarker, end: endMarker }) {
  const file = path.join(projectDir, name);
  if (!fs.existsSync(file)) return false;
  const existing = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const start = existing.indexOf(startMarker);
  const end = start >= 0 ? existing.indexOf(endMarker, start) : -1;
  if (end < 0) return false;
  const before = existing.slice(0, start).trimEnd();
  const after = existing.slice(end + endMarker.length).trim();
  const rest = [before, after].filter(Boolean).join('\n\n');
  if (rest) fs.writeFileSync(file, `${rest}\n`);
  else fs.rmSync(file);
  return true;
}

// The kit's copies stay committed (ADR 0014), so this block marks them as generated: GitHub then
// collapses them in pull requests and leaves them out of the language stats (ADR 0015).
const GENERATED_BLOCK = { file: '.gitattributes', start: '# ourkit:start', end: '# ourkit:end' };

function generatedPatterns() {
  const shell = readShell();
  return [
    `${toRecordPath(KIT_DIR)}/**`,
    toRecordPath(INSTALL_RECORD),
    `${shell.stagesDir}/ourkit-*/**`,
    `${shell.agentsDir}/ourkit-*`,
    `${shell.rulesDir}/ourkit.md`,
  ];
}

// Writes the block, or replaces the one already there, leaving the rest of the file alone.
// Returns whether the file changed.
function markGenerated(projectDir) {
  const { file: name, start, end } = GENERATED_BLOCK;
  const file = path.join(projectDir, name);
  const block = [
    `${start} (written by ourkit: the kit's own files, collapsed in pull requests)`,
    ...generatedPatterns().map((pattern) => `${pattern} linguist-generated=true`),
    end,
  ].join('\n');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : '';
  const from = existing.indexOf(start);
  const to = from >= 0 ? existing.indexOf(end, from) : -1;
  const updated = to >= 0
    ? `${existing.slice(0, from)}${block}${existing.slice(to + end.length)}`
    : `${existing.trimEnd() ? `${existing.trimEnd()}\n\n` : ''}${block}\n`;
  if (updated === existing) return false;
  fs.writeFileSync(file, updated);
  return true;
}

const removeLegacyInstructions = (projectDir) => removeLegacyBlock(projectDir, LEGACY_BLOCKS.instructions);
const removeLegacyGitignore = (projectDir) => removeLegacyBlock(projectDir, LEGACY_BLOCKS.gitignore);

function install(projectDir, { entry, roles }) {
  if (fs.existsSync(path.join(projectDir, INSTALL_RECORD))) {
    return { error: `ourkit is already installed in ${projectDir}; use upgrade to update it` };
  }
  const plan = planFiles(projectDir, roles);
  const existing = plan.filter(({ target }) => fs.existsSync(path.join(projectDir, target)));
  if (existing.length > 0) {
    const names = existing.map(({ target }) => toRecordPath(target)).join(', ');
    return { error: `ourkit is already installed in ${projectDir}, or these files are in the way: ${names}` };
  }
  const detected = STACK_MARKERS.filter((name) => fs.existsSync(path.join(projectDir, name)));
  const files = copyPlanned(projectDir, plan);
  const record = { version: kitVersion(), host: HOST, entry, roles, detected, files };
  fs.writeFileSync(path.join(projectDir, INSTALL_RECORD), `${JSON.stringify(record, null, 2)}\n`);
  markGenerated(projectDir);
  return { record };
}

function parseArgs(args) {
  const options = {};
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--entry' || args[i] === '--roles') options[args[i].slice(2)] = args[(i += 1)] ?? '';
    else rest.push(args[i]);
  }
  return { options, projectArg: rest[0] };
}

// Keeps asking until the answer is valid. Returns null when input ends.
async function ask(lines, prompt, parse) {
  for (;;) {
    process.stdout.write(prompt);
    const { value, done } = await lines.next();
    if (done) return null;
    const parsed = parse(value);
    if (!parsed.error) return parsed;
    console.log(parsed.error);
  }
}

// Typed answers, for piped input. Returns null when input ends.
async function askTyped(suggested, need) {
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const answers = {};
  if (need.entry) {
    answers.entry = await ask(lines, `New project (no code yet) or existing project (has code)? [${suggested}] `, (answer) =>
      parseEntry(answer.trim() || suggested));
  }
  if (answers.entry !== null && need.roles) {
    const options = roleChoices().map(({ answer }) => answer).join(', ');
    answers.roles = await ask(lines, `Roles? ${options}, separated by commas: `, (answer) =>
      (answer.trim() ? parseRoles(answer) : { error: 'choose at least one option, or none' }));
  }
  rl.close();
  return answers;
}

// Arrow-key menus, for a person at a terminal. Returns null for an answer the user cancelled.
async function askWithMenus(suggested, need) {
  const answers = {};
  if (need.entry) {
    const entries = [{ label: 'Existing project (has code)', answer: 'existing' }, { label: 'New project (no code yet)', answer: 'new' }];
    const chosen = await select('Is this project new or existing?', entries.map(({ label }) => label),
      entries.findIndex(({ answer }) => answer === suggested));
    answers.entry = chosen === null ? null : parseEntry(entries[chosen].answer);
  }
  if (answers.entry !== null && need.roles) {
    const choices = roleChoices();
    const chosen = await select('Which Roles?', choices.map(({ label }) => label));
    answers.roles = chosen === null ? null : parseRoles(choices[chosen].answer);
  }
  return answers;
}

async function main(args) {
  const { options, projectArg } = parseArgs(args);
  const projectDir = path.resolve(projectArg || process.cwd());
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
    console.error(`ourkit: no folder at ${projectDir}`);
    return 2;
  }
  let entryResult = options.entry === undefined ? null : parseEntry(options.entry);
  let rolesResult = options.roles === undefined ? null : parseRoles(options.roles);
  for (const result of [entryResult, rolesResult]) {
    if (result && result.error) {
      console.error(`ourkit: ${result.error}`);
      return 2;
    }
  }
  if (!entryResult || !rolesResult) {
    const suggested = hasProjectCode(projectDir) ? 'existing' : 'new';
    const need = { entry: !entryResult, roles: !rolesResult };
    const interactive = process.stdin.isTTY && process.stdout.isTTY;
    const answers = await (interactive ? askWithMenus(suggested, need) : askTyped(suggested, need));
    if (need.entry) entryResult = answers.entry ?? null;
    if (need.roles) rolesResult = answers.roles ?? null;
    if (!entryResult || !rolesResult) {
      console.error(`ourkit: ${interactive ? 'cancelled' : 'input ended'} before every question was answered; nothing was installed`);
      return 2;
    }
  }
  const { error, record } = install(projectDir, { entry: entryResult.entry, roles: rolesResult.roles });
  if (error) {
    console.error(`ourkit: ${error}`);
    return 1;
  }
  console.log(`ourkit: installed ${Object.keys(record.files).length} files (${record.entry}; Roles: ${record.roles.join(', ') || 'none'})`);
  if (record.detected.length > 0) console.log(`ourkit: found ${record.detected.join(', ')}`);
  console.log('ourkit: commit everything it added in a commit of its own, so a teammate needs nothing after cloning; .gitattributes marks the kit\'s files as generated, so pull requests collapse them');
  console.log('ourkit: then open the agent in this project and run /ourkit-init');
  return 0;
}

module.exports = {
  INSTALL_RECORD, KIT_ROOT, copyPlanned, hashFile, install, kitVersion, main, markGenerated, parseEntry, parseRoles, planFiles,
  removeLegacyGitignore, removeLegacyInstructions, roleChoices, syncCommand, trackerPlan,
};
