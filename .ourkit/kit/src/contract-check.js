// Contract Check: verifies that the kit's extension points satisfy their contracts.
// Role, Stack Pack and Tracker Pack contracts arrive in #5, #6 and #32.
const fs = require('fs');
const path = require('path');
const { checkConnectors } = require('./connectors');
const { OVERRIDES_DIR, orphanOverrides } = require('./overrides');

const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKILL_NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const STAGE_PREFIX = 'ourkit-';
const FORBIDDEN_ROLES = ['fullstack', 'full-stack'];
const MODEL_STRENGTHS = ['strong', 'balanced', 'cheap'];
const TRACKER_OPERATIONS = ['Read a ticket', 'Change status', 'Comment', 'Attach a PR link'];
const PROJECT_ROLES_DIR = path.join('.ourkit', 'roles');

// ADR 0002: Core never assumes a stack. A list can't catch everything, so this
// stops the common slips and doesn't replace review.
const STACK_COMMANDS = [
  'npm', 'npx', 'yarn', 'pnpm', 'pip', 'pip3', 'pipenv', 'uvx', 'pytest', 'tox',
  'cargo', 'gradle', 'gradlew', 'mvn', 'dotnet', 'vitest',
  'package.json', 'node_modules', 'requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod',
  'pom.xml', 'Gemfile',
];
// Commands that are ordinary English words count only in their full, lowercase form.
const STACK_COMMAND_PHRASES = [
  'go test', 'go run', 'go build', 'bundle exec', 'bundle install', 'poetry run', 'poetry install',
  'composer install', 'composer require', 'rake test', 'jest --', 'uv run', 'uv sync',
];
const STACK_NAMES = [
  'JavaScript', 'TypeScript', 'Node.js', 'Python', 'Ruby', 'Java', 'PHP', 'Golang', 'Kotlin',
  'Next.js', 'Vue', 'Angular', 'Svelte', 'Django', 'Flask', 'FastAPI', 'Rails', 'Laravel', 'NestJS',
];
// Names that are also English words count only mid-sentence, because a capital at the
// start of a sentence says nothing. "React is required" at the start of a line is missed.
const AMBIGUOUS_STACK_NAMES = ['Node', 'Rust', 'Swift', 'React', 'Express', 'Spring'];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (term, flags) => new RegExp(`(?<![\\w.-])${escapeRegExp(term)}(?![\\w-])`, flags);
const midSentence = (term) => new RegExp(`(?<=[a-z0-9,;:] )${escapeRegExp(term)}(?![\\w-])`);
const STACK_TERMS = [
  ...STACK_COMMANDS.map((term) => ({ term, pattern: wholeWord(term, 'i') })),
  ...STACK_COMMAND_PHRASES.map((term) => ({ term, pattern: wholeWord(term, '') })),
  ...STACK_NAMES.map((term) => ({ term, pattern: wholeWord(term, '') })),
  ...AMBIGUOUS_STACK_NAMES.map((term) => ({ term, pattern: midSentence(term) })),
];

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function subfolders(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

// Returns null when the file has no frontmatter block.
function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { fields, body: text.slice(match[0].length) };
}

function checkStage(root, stage) {
  const problems = [];
  const report = (file, message) => problems.push({ file, contract: 'Stage', message });
  const folder = path.join('stages', stage);
  const skillPath = path.join(folder, 'SKILL.md');
  const absolute = path.join(root, skillPath);

  if (!fs.existsSync(absolute)) {
    report(folder, 'must contain SKILL.md');
    return problems;
  }
  const parsed = parseFrontmatter(readText(absolute));
  if (!parsed) {
    report(skillPath, 'must start with a frontmatter block');
    return problems;
  }
  const { name, description } = parsed.fields;
  if (!name) {
    report(skillPath, 'frontmatter must set name');
  } else {
    if (name !== stage) report(skillPath, `name "${name}" must match its folder "${stage}"`);
    if (!SKILL_NAME.test(name) || name.length > SKILL_NAME_MAX) {
      report(skillPath, `name "${name}" must be lowercase words joined by single hyphens, at most ${SKILL_NAME_MAX} characters`);
    }
    if (!name.startsWith(STAGE_PREFIX)) report(skillPath, `name "${name}" must start with "${STAGE_PREFIX}"`);
  }
  if (!description) {
    report(skillPath, 'frontmatter must set description');
  } else if (/^[|>]/.test(description)) {
    report(skillPath, 'description must be on one line');
  } else if (description.length > DESCRIPTION_MAX) {
    report(skillPath, `description must be at most ${DESCRIPTION_MAX} characters`);
  }
  if (!parsed.body.trim()) report(skillPath, 'must have instructions after the frontmatter');
  return problems;
}

// A Project Role follows the same contract, so `rolesDir` is either location.
function checkRole(root, rolesDir, role) {
  const problems = [];
  const report = (file, message) => problems.push({ file, contract: 'Role', message });
  const folder = path.join(rolesDir, role);

  if (!SKILL_NAME.test(role)) report(folder, 'folder name must be lowercase words joined by single hyphens');
  if (FORBIDDEN_ROLES.includes(role)) {
    report(folder, 'Full-stack means enabling the frontend and backend Roles together; it is not a Role');
  }
  for (const name of ['guidance.md', 'checklist.md']) {
    const relative = path.join(folder, name);
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) {
      report(folder, `must contain ${name}`);
    } else if (!readText(absolute).trim()) {
      report(relative, 'must not be empty');
    } else if (name === 'checklist.md' && !/^- \[ \] \S/m.test(readText(absolute))) {
      report(relative, 'must have at least one "- [ ]" item');
    }
  }
  return problems;
}

// `folder` is relative to `root`, because a pack is also checked before installation.
function checkStackPack(root, folder) {
  const problems = [];
  const report = (file, message) => problems.push({ file, contract: 'Stack Pack', message });
  const pack = path.basename(path.resolve(root, folder));
  const manifestPath = path.join(folder, 'pack.json');
  const conventionsPath = path.join(folder, 'conventions.md');

  if (!SKILL_NAME.test(pack)) report(folder, 'folder name must be lowercase words joined by single hyphens');
  if (!fs.existsSync(path.join(root, conventionsPath))) {
    report(folder, 'must contain conventions.md');
  } else if (!readText(path.join(root, conventionsPath)).trim()) {
    report(conventionsPath, 'must not be empty');
  }
  if (!fs.existsSync(path.join(root, manifestPath))) {
    report(folder, 'must contain pack.json');
    return problems;
  }
  let manifest;
  try {
    manifest = JSON.parse(readText(path.join(root, manifestPath)));
  } catch (error) {
    report(manifestPath, `must be valid JSON: ${error.message}`);
    return problems;
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    report(manifestPath, 'must be a JSON object');
    return problems;
  }
  if (manifest.name !== pack) report(manifestPath, `name must match its folder "${pack}"`);
  const { technologies } = manifest;
  if (
    !Array.isArray(technologies) ||
    technologies.length === 0 ||
    technologies.some((t) => typeof t !== 'string' || !t.trim())
  ) {
    report(manifestPath, 'technologies must list at least one name');
  }
  return problems;
}

// ADR 0008: a Host Shell with subagents maps each strength to a model and names it in frontmatter.
function checkHostAgents(root, host, shell) {
  const agentsFolder = path.join('hosts', host, 'agents');
  const absolute = path.join(root, agentsFolder);
  if (!fs.existsSync(absolute)) return [];
  const problems = [];
  const report = (file, message) => problems.push({ file, contract: 'Host Shell', message });
  const shellPath = path.join('hosts', host, 'shell.json');

  const { agentsDir, models } = shell;
  if (
    typeof agentsDir !== 'string' ||
    !agentsDir.trim() ||
    path.isAbsolute(agentsDir) ||
    path.win32.isAbsolute(agentsDir) ||
    agentsDir.split(/[\\/]/).includes('..')
  ) {
    report(shellPath, 'agentsDir must be a path inside the project');
  }
  const validModels = [];
  for (const strength of MODEL_STRENGTHS) {
    const model = models && models[strength];
    if (typeof model !== 'string' || !model.trim()) report(shellPath, `models must map "${strength}" to a model`);
    else validModels.push(model);
  }
  for (const file of fs.readdirSync(absolute)) {
    const relative = path.join(agentsFolder, file);
    const parsed = parseFrontmatter(readText(path.join(root, relative)));
    if (!parsed) {
      report(relative, 'must start with a frontmatter block');
      continue;
    }
    const { name, description, model } = parsed.fields;
    if (name !== path.basename(file, '.md')) report(relative, `name must match its file "${path.basename(file, '.md')}"`);
    if (!name || !name.startsWith(STAGE_PREFIX)) report(relative, `name must start with "${STAGE_PREFIX}"`);
    if (!description) report(relative, 'frontmatter must set description');
    if (!validModels.includes(model)) report(relative, `model must be one of the Host Shell's models: ${validModels.join(', ')}`);
    if (!parsed.body.trim()) report(relative, 'must have instructions after the frontmatter');
  }
  return problems;
}

function checkTrackerPack(root, pack) {
  const problems = [];
  const report = (file, message) => problems.push({ file, contract: 'Tracker Pack', message });
  const folder = path.join('tracker-packs', pack);
  const manifestPath = path.join(folder, 'pack.json');
  const operationsPath = path.join(folder, 'operations.md');

  if (!SKILL_NAME.test(pack)) report(folder, 'folder name must be lowercase words joined by single hyphens');
  if (!fs.existsSync(path.join(root, manifestPath))) {
    report(folder, 'must contain pack.json');
  } else {
    let manifest = null;
    try {
      manifest = JSON.parse(readText(path.join(root, manifestPath)));
    } catch (error) {
      report(manifestPath, `must be valid JSON: ${error.message}`);
    }
    if (manifest !== null) {
      if (manifest.name !== pack) report(manifestPath, `name must match its folder "${pack}"`);
      if (typeof manifest.tracker !== 'string' || !manifest.tracker.trim()) report(manifestPath, 'tracker must name the Tracker');
    }
  }
  if (!fs.existsSync(path.join(root, operationsPath))) {
    report(folder, 'must contain operations.md');
    return problems;
  }
  const text = readText(path.join(root, operationsPath));
  for (const operation of TRACKER_OPERATIONS) {
    const match = text.match(new RegExp(`^## ${operation}[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
    if (!match) report(operationsPath, `must have a "## ${operation}" section`);
    else if (!match[1].trim()) report(operationsPath, `the "## ${operation}" section must not be empty`);
  }
  return problems;
}

function checkHostShell(root, host) {
  const shellPath = path.join('hosts', host, 'shell.json');
  const report = (message) => ({ file: shellPath, contract: 'Host Shell', message });
  const absolute = path.join(root, shellPath);

  if (!fs.existsSync(absolute)) return [report('file is missing')];
  let shell;
  try {
    shell = JSON.parse(readText(absolute));
  } catch (error) {
    return [report(`must be valid JSON: ${error.message}`)];
  }
  if (shell === null || typeof shell !== 'object' || Array.isArray(shell)) {
    return [report('must be a JSON object')];
  }
  const problems = [];
  if (shell.host !== host) problems.push(report(`host must match its folder "${host}"`));
  problems.push(...checkHostAgents(root, host, shell));
  const { stagesDir } = shell;
  if (typeof stagesDir !== 'string' || !stagesDir.trim()) {
    problems.push(report('stagesDir must be a non-empty path'));
  } else if (
    path.isAbsolute(stagesDir) ||
    path.win32.isAbsolute(stagesDir) ||
    stagesDir.split(/[\\/]/).includes('..')
  ) {
    problems.push(report(`stagesDir "${stagesDir}" must stay inside the project`));
  }
  return problems;
}

function checkStackNeutral(root) {
  const problems = [];
  for (const dir of ['core', 'roles', 'stages']) {
    for (const file of filesUnder(path.join(root, dir))) {
      const text = readText(file);
      if (text.includes('\0')) continue; // binary resource
      const relative = path.relative(root, file);
      text.split('\n').forEach((line, index) => {
        for (const { term, pattern } of STACK_TERMS) {
          if (pattern.test(line)) {
            problems.push({
              file: `${relative}:${index + 1}`,
              contract: 'Stack neutrality',
              message: `mentions "${term}"; read it from the Stack Profile or move it to a Stack Pack (ADR 0002)`,
            });
          }
        }
      });
    }
  }
  return problems;
}

function runContractCheck(root) {
  const stages = subfolders(path.join(root, 'stages'));
  const hosts = subfolders(path.join(root, 'hosts'));
  const roles = subfolders(path.join(root, 'roles'));
  const packs = subfolders(path.join(root, 'stack-packs'));
  const trackers = subfolders(path.join(root, 'tracker-packs'));
  const problems = [];
  if (stages.length === 0) problems.push({ file: 'stages', contract: 'Stage', message: 'must contain at least one Stage' });
  if (hosts.length === 0) problems.push({ file: 'hosts', contract: 'Host Shell', message: 'must contain at least one Host Shell' });
  for (const stage of stages) problems.push(...checkStage(root, stage));
  for (const host of hosts) problems.push(...checkHostShell(root, host));
  for (const role of roles) problems.push(...checkRole(root, 'roles', role));
  for (const pack of packs) problems.push(...checkStackPack(root, path.join('stack-packs', pack)));
  for (const tracker of trackers) problems.push(...checkTrackerPack(root, tracker));
  problems.push(...checkStackNeutral(root));
  return { problems, stages: stages.length, hosts: hosts.length, roles: roles.length, packs: packs.length, trackers: trackers.length };
}

// Project Roles aren't held to stack neutrality: they belong to one project, whose stack is known.
function runProjectCheck(projectDir) {
  const roles = subfolders(path.join(projectDir, PROJECT_ROLES_DIR));
  const problems = roles.flatMap((role) => checkRole(projectDir, PROJECT_ROLES_DIR, role));
  problems.push(...checkConnectors(projectDir));
  for (const relative of orphanOverrides(projectDir)) {
    problems.push({
      file: path.join(OVERRIDES_DIR, relative),
      contract: 'Override',
      message: 'has no matching kit file, so it has no effect',
    });
  }
  return { problems, roles: roles.length };
}

function report(problems, success) {
  for (const { file, contract, message } of problems) {
    console.error(`${file.replace(/\\/g, '/')}: [${contract}] ${message}`);
  }
  if (problems.length > 0) {
    console.error(`ourkit check: ${problems.length} problem(s)`);
    return 1;
  }
  console.log(`ourkit check: OK (${success})`);
  return 0;
}

// Returns the process exit code.
function main(firstArg, secondArg) {
  if (firstArg === '--project') {
    const { problems, roles } = runProjectCheck(path.resolve(secondArg || process.cwd()));
    return report(problems, `${roles} Project Role(s)`);
  }
  const root = path.resolve(firstArg || path.join(__dirname, '..'));
  const { problems, stages, hosts, roles, packs, trackers } = runContractCheck(root);
  return report(problems, `${stages} Stage(s), ${hosts} Host Shell(s), ${roles} Role(s), ${packs} Stack Pack(s), ${trackers} Tracker Pack(s)`);
}

module.exports = { checkStackPack, main, runContractCheck, runProjectCheck };
