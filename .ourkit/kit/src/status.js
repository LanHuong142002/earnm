// Where the Active Change stands: what's done, what's waiting for the user, and what comes next.
// `ourkit status --line` prints it as one line for Claude Code's status line, which costs no tokens.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { activeChange } = require('./active-change');
const { checkArtifact, parseTasks, readDocument, relativePathFor } = require('./artifacts');
const { readChange, updateChange } = require('./change-state');
const { INSTALL_RECORD } = require('./install');
const { stagesFor } = require('./tier');
const { summarize } = require('./tasks');
const { stopRequired } = require('./handsoff');

const SKILLS = {
  Spec: '/ourkit-spec',
  Plan: '/ourkit-plan',
  Tasks: '/ourkit-tasks',
  Build: '/ourkit-build',
  Review: '/ourkit-review',
  QA: '/ourkit-qa',
  Ship: '/ourkit-ship',
  Reproduce: '/ourkit-bugfix',
  Fix: '/ourkit-bugfix',
  Verify: '/ourkit-bugfix',
  Grill: '/ourkit-epic',
  'Split into Features': '/ourkit-epic',
};
const BUG_SECTIONS = { Reproduce: 'Reproduction', Fix: 'Fix', Verify: 'Verification' };
const SETTINGS_LOCAL = path.join('.claude', 'settings.local.json');
// Matches the command `statusline on` writes, with or without quotes around the path.
const isOurs = (command) => /ourkit.js"? status --line/.test(command || '');

function git(dir, args) {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

const artifactDone = (projectDir, name, id) => {
  if (!fs.existsSync(path.join(projectDir, relativePathFor(name, id)))) return false;
  return checkArtifact(projectDir, name, id).length === 0;
};

// True when the "## <section>" of a document has something under it.
function sectionFilled(projectDir, name, id, section) {
  const file = path.join(projectDir, relativePathFor(name, id));
  if (!fs.existsSync(file)) return false;
  const text = readDocument(file);
  const match = text.match(new RegExp(`^## ${section}[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return Boolean(match && match[1].trim());
}

function taskProgress(projectDir, record, id) {
  if (!artifactDone(projectDir, 'tasks', id)) return null;
  const tasks = parseTasks(readDocument(path.join(projectDir, relativePathFor('tasks', id))));
  const summary = summarize(tasks, record.taskStatus || {});
  const done = summary.tasks.filter((task) => task.status === 'done').length;
  const blocked = summary.tasks.filter((task) => task.status === 'blocked').map(({ id: taskId, title, reason }) => ({ id: taskId, title, reason }));
  return { done, total: tasks.length, blocked, finished: summary.finished && blocked.length === 0 };
}

function planApproved(projectDir, record, id) {
  if (record.mode === 'hands-off' && !stopRequired(record)) return true;
  if (!record.planApproval) return false;
  const { hashFile } = require('./install');
  return record.planApproval === hashFile(path.join(projectDir, relativePathFor('plan', id)));
}

function reviewPassed(projectDir, record, change) {
  return require('./review').reviewGate(projectDir, record, change).status === 'pass';
}

// Works out each Stage's state in order; the first one not done is the current one.
function stageStates(projectDir, record, change) {
  const id = change.id;
  const tasks = taskProgress(projectDir, record, id);
  const check = {
    Spec: () => artifactDone(projectDir, 'spec', id),
    Plan: () => artifactDone(projectDir, 'plan', id) && planApproved(projectDir, record, id),
    Tasks: () => artifactDone(projectDir, 'tasks', id),
    Build: () => (record.tier === 'patch' ? change.files.length > 0 : Boolean(tasks && tasks.finished)),
    Review: () => reviewPassed(projectDir, record, change),
    QA: () => require('./qa').qaGate(projectDir, record, change).status === 'pass',
    Ship: () => Boolean(record.pr),
    Grill: () => fs.existsSync(path.join(projectDir, relativePathFor('epic', id))),
    'Split into Features': () => artifactDone(projectDir, 'epic', id),
  };
  for (const [stage, section] of Object.entries(BUG_SECTIONS)) check[stage] = () => sectionFilled(projectDir, 'bug', id, section);
  let current = null;
  const stages = stagesFor(record).map((name) => {
    if (current) return { name, state: 'todo' };
    if (check[name]()) return { name, state: 'done' };
    current = name;
    return { name, state: 'current' };
  });
  return { stages, current, tasks };
}

function pendingItems(projectDir) {
  const file = path.join(projectDir, '.ourkit', 'pending.json');
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).filter((item) => !item.done).map((item) => item.text || item.what || String(item));
  } catch {
    return [];
  }
}

function otherBranches(projectDir, current) {
  const out = git(projectDir, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads']) || '';
  return out.split('\n').filter((name) => name && name !== current && !['main', 'master'].includes(name)).slice(0, 3);
}

function nextStep({ current, waiting, record, planWritten, tasks, findings }) {
  const questions = waiting.filter((item) => item.kind === 'question').length;
  const before = questions > 0 ? `answer ${questions} open question${questions > 1 ? 's' : ''}, then ` : '';
  if (!current) {
    if (record.pr) return { skill: null, text: 'review and merge the PR', waitsForYou: true };
    if (record.tier === 'patch') return { skill: null, text: 'commit it yourself', waitsForYou: true };
    if (record.tier === 'epic') return { skill: '/ourkit-spec', text: 'start each Feature on its own branch', waitsForYou: true };
    return { skill: '/ourkit-ship', text: 'open the PR', waitsForYou: false };
  }
  if (current === 'Plan' && planWritten) return { skill: '/ourkit-tasks', text: `${before}approve the plan, then tasks`, waitsForYou: true };
  if (current === 'Build' && tasks && tasks.blocked.length > 0) {
    return { skill: '/ourkit-build', text: `${before}unblock task ${tasks.blocked.map((t) => t.id).join(', ')}, then build`, waitsForYou: true };
  }
  if (current === 'QA') return { skill: '/ourkit-qa', text: `${before}check it against the spec`, waitsForYou: questions > 0 };
  if (current === 'Review' && findings > 0) return { skill: '/ourkit-review', text: `fix ${findings} blocking finding${findings > 1 ? 's' : ''}`, waitsForYou: false };
  if (current === 'Ship' && record.mode === 'hands-off' && stopRequired(record) && !record.shipApproval) {
    return { skill: '/ourkit-ship', text: `${before}approve what was built, then ship`, waitsForYou: true };
  }
  return { skill: SKILLS[current], text: `${before}${current.toLowerCase()}`, waitsForYou: questions > 0 };
}

function statusLineState(projectDir) {
  const file = path.join(projectDir, SETTINGS_LOCAL);
  try {
    const command = JSON.parse(fs.readFileSync(file, 'utf8')).statusLine?.command || '';
    return isOurs(command) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function computeStatus(projectDir) {
  if (!fs.existsSync(path.join(projectDir, INSTALL_RECORD))) return { installed: false };
  const branch = git(projectDir, ['branch', '--show-current']) || null;
  const pending = pendingItems(projectDir);
  const base = { installed: true, branch, statusLine: statusLineState(projectDir), pending };
  const change = activeChange(projectDir);
  if (change.error) {
    return {
      ...base,
      change: null,
      reason: change.error,
      unfinishedBranches: otherBranches(projectDir, branch),
      next: { skill: '/ourkit-spec', text: 'describe a change, or switch to an unfinished branch', waitsForYou: true },
    };
  }
  const record = readChange(projectDir, change.id);
  const summary = {
    ...base,
    change: change.id,
    tier: record.tier || null,
    mode: record.mode || 'pair',
    flow: record.flow || 'standard',
    sensitiveAreas: record.sensitiveAreas || [],
    ticket: record.ticket || null,
    pr: record.pr || null,
  };
  if (!record.tier) {
    return { ...summary, stages: [], current: 'Sizing', waiting: [], next: { skill: '/ourkit-spec', text: 'describe the change so ourkit can size it', waitsForYou: true } };
  }
  const { stages, current, tasks } = stageStates(projectDir, record, change);
  const findings = ((record.review || {}).findings || []).filter((f) => f.severity === 'blocking' && !f.resolved);
  const planWritten = artifactDone(projectDir, 'plan', change.id);
  const waiting = [
    ...(record.questions || []).filter((q) => q.answer === null).map((q) => ({ kind: 'question', text: q.question })),
    ...(current === 'Plan' && planWritten ? [{ kind: 'approval', text: 'approve the plan' }] : []),
    ...(tasks ? tasks.blocked.map((t) => ({ kind: 'blocked', text: `task ${t.id} is blocked: ${t.reason}` })) : []),
    ...(record.serviceActions || []).map((text) => ({ kind: 'service', text })),
    ...(record.pr && !current ? [{ kind: 'merge', text: `review and merge ${record.pr}` }] : []),
  ];
  return {
    ...summary,
    stages,
    current,
    tasks: tasks ? { done: tasks.done, total: tasks.total } : null,
    blockingFindings: findings.length,
    waiting,
    next: nextStep({ current, waiting, record, planWritten, tasks, findings: findings.length }),
  };
}

const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function renderLine(status) {
  if (!status.installed) return '';
  const parts = ['ourkit'];
  if (!status.change) {
    parts.push(status.branch || 'no branch', 'no change in progress');
  } else {
    parts.push(shorten(status.change, 28));
    if (status.tier) parts.push(`${status.tier[0].toUpperCase()}${status.tier.slice(1)}${status.mode === 'hands-off' ? ' (hands-off)' : ''}`);
    if (status.current === null) parts.push(status.pr ? '✅ PR open' : '✅ done');
    else if (status.current === 'Build' && status.tasks) parts.push(`🔨 Build ${status.tasks.done}/${status.tasks.total}`);
    else parts.push(`🔨 ${status.current}`);
    const waits = status.waiting.filter((w) => w.kind !== 'merge');
    if (waits.length > 0) parts.push(`⏳ ${waits.length} waiting on you`);
  }
  if (status.pending.length > 0) parts.push(`📌 ${status.pending.length} to do`);
  const { next } = status;
  parts.push(next.waitsForYou || !next.skill ? `Next: ✋ ${shorten(next.text, 44)}` : `Next: ${next.skill}`);
  return parts.join(' · ');
}

// Claude Code passes session details on stdin; its project_dir is where ourkit lives.
function projectFromStdin() {
  if (process.stdin.isTTY) return null;
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    return input.workspace?.project_dir || input.workspace?.current_dir || input.cwd || null;
  } catch {
    return null;
  }
}

function main(args) {
  const [first, value] = args;
  if (first === '--line') {
    try {
      const dir = projectFromStdin() || process.cwd();
      const projectDir = git(dir, ['rev-parse', '--show-toplevel']) || dir;
      process.stdout.write(renderLine(computeStatus(path.resolve(projectDir))));
    } catch {
      process.stdout.write('ourkit');
    }
    return 0;
  }
  const projectDir = process.cwd();
  if (first === 'pr') {
    const change = activeChange(projectDir);
    if (change.error || !value || !value.trim()) {
      console.error(change.error ? `ourkit: no Active Change: ${change.error}` : 'usage: ourkit status pr <link>');
      return change.error ? 1 : 2;
    }
    updateChange(projectDir, change.id, { pr: value.trim() });
    console.log('ourkit: recorded the PR, so status shows it waiting for your merge');
    return 0;
  }
  if (first !== undefined) {
    console.error('usage: ourkit status [--line | pr <link>]');
    return 2;
  }
  console.log(JSON.stringify(computeStatus(projectDir), null, 2));
  return 0;
}

// --- Turning the status line on and off, in this machine's own settings for the project ---

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function statusLineMain(args) {
  const [action, flag] = args;
  const projectDir = process.cwd();
  if (!fs.existsSync(path.join(projectDir, INSTALL_RECORD))) {
    console.error('ourkit: ourkit is not installed here; run this from the project root');
    return 2;
  }
  const file = path.join(projectDir, SETTINGS_LOCAL);
  let settings;
  try {
    settings = readJson(file);
  } catch {
    console.error(`ourkit: ${SETTINGS_LOCAL} isn't valid JSON; fix it first`);
    return 1;
  }
  const existing = settings.statusLine?.command || '';
  const ours = isOurs(existing);

  if (action === 'on') {
    if (ours) {
      console.log('ourkit: the status line is already on');
      return 0;
    }
    const replace = flag === '--replace';
    let personal = '';
    try {
      personal = readJson(path.join(os.homedir(), '.claude', 'settings.json')).statusLine?.command || '';
    } catch {
      personal = '';
    }
    if ((existing || personal) && !replace) {
      console.error(`ourkit: you already have a status line (${shorten(existing || personal, 60)}), so nothing was changed`);
      console.error('ourkit: run `ourkit statusline on --replace` to show ourkit instead in this project,');
      console.error(`ourkit: or add the output of \`node ${path.join(projectDir, '.ourkit/kit/bin/ourkit.js').replace(/\\/g, '/')} status --line\` to your own`);
      return 1;
    }
    const script = path.join(projectDir, '.ourkit', 'kit', 'bin', 'ourkit.js').replace(/\\/g, '/');
    settings.statusLine = { type: 'command', command: `node "${script}" status --line`, padding: 0 };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    console.log('ourkit: the status line is on for you in this project; it shows on your next message in Claude Code');
    if (git(projectDir, ['check-ignore', '-q', SETTINGS_LOCAL.replace(/\\/g, '/')]) === null) {
      console.log(`ourkit: ${SETTINGS_LOCAL.replace(/\\/g, '/')} holds this machine's own settings; add it to .gitignore so it isn't committed`);
    }
    return 0;
  }
  if (action === 'off') {
    if (!existing) {
      console.log('ourkit: the status line is already off');
      return 0;
    }
    if (!ours) {
      console.log("ourkit: the status line here isn't ourkit's, so it was left alone");
      return 0;
    }
    delete settings.statusLine;
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    console.log('ourkit: the status line is off');
    return 0;
  }
  if (action === undefined || action === 'show') {
    console.log(`ourkit: the status line is ${ours ? 'on' : 'off'}`);
    return 0;
  }
  console.error('usage: ourkit statusline <on [--replace] | off | show>');
  return 2;
}

module.exports = { computeStatus, main, renderLine, statusLineMain };
