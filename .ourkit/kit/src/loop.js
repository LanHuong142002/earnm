// Loop Run: Hands-off across many tickets. This code is the coordinator, not an agent, so the
// Budget can't be talked past and a ticket's context costs nothing once it ends (ADRs 0009, 0011).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { REPORT_PATH, writeReport } = require('./run-report');

const LOOP_PATH = path.join('.ourkit', 'loop.json');
const SHELL_PATH = path.join('.ourkit', 'kit', 'host', 'shell.json');
// The setup list isn't context, but it's for the user, so it must not vanish with a ticket's branch.
const CARRIED = [path.join('.ourkit', 'lessons.md'), path.join('.ourkit', 'project-log.md'), path.join('.ourkit', 'pending.json')];
const SUMMARY_LINES = 5;
const OUTCOMES = ['shipped', 'stopped', 'blocked', 'rejected'];
const LIMIT_THRESHOLD = 0.9;
const WAIT_MARGIN_MS = 60 * 1000;
// A seven-day window can be days away. A process shouldn't sit waiting that long, so it stops instead.
const MAX_WAIT_MS = 6 * 3600 * 1000;

const promptFor = (item, resumeBranch) => `/ourkit-handsoff ${item}

You are one ticket in a Loop Run, with no one watching, so never wait for a reply. Run each shell command on its own, without chaining commands or changing directory, because permissions are checked per command and a refused command can't be retried by anyone. When you stop or finish, end your final message with exactly ${SUMMARY_LINES} lines summarizing what happened, then one last line:
OURKIT-RESULT: shipped, stopped, blocked or rejected
Use shipped if a PR is open, stopped if it's waiting for the user's approval or answers, blocked if you can't make progress, and rejected if the ticket failed intake.${resumeBranch ? resumeNote(resumeBranch) : ''}`;

const resumeNote = (branch) => `

An earlier session on this ticket ended before it finished, and its work is saved on the branch \`${branch}\`, which is checked out for you. Carry on from where it stopped, starting with \`ourkit handsoff status\`, rather than starting again.`;

function git(projectDir, args) {
  const result = spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  return { ok: result.status === 0, output: (result.stdout || '').trim() };
}

function defaultBranch(projectDir) {
  const remote = git(projectDir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (remote.ok) return remote.output.replace(/^origin\//, '');
  return ['main', 'master'].find((name) => git(projectDir, ['rev-parse', '--verify', '--quiet', name]).ok) || null;
}

function readLoop(projectDir) {
  const file = path.join(projectDir, LOOP_PATH);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// The run's state must survive moving between branches, so git must never track it. This
// writes to .git/info/exclude, which stays on this machine and doesn't change the repo.
function keepStateOutOfGit(projectDir) {
  const excludeFile = git(projectDir, ['rev-parse', '--git-path', 'info/exclude']);
  if (!excludeFile.ok) return;
  const file = path.resolve(projectDir, excludeFile.output);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const present = existing.split(/\r?\n/);
  const missing = [LOOP_PATH, REPORT_PATH].map((entry) => entry.replace(/\\/g, '/')).filter((entry) => !present.includes(entry));
  if (missing.length === 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
}

function writeLoop(projectDir, loop) {
  const file = path.join(projectDir, LOOP_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(loop, null, 2)}\n`);
}

function sessionCommand(projectDir) {
  if (process.env.OURKIT_LOOP_COMMAND) return { command: process.env.OURKIT_LOOP_COMMAND, args: [] };
  const file = path.join(projectDir, SHELL_PATH);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).session : null;
}

// The Budget is checked in here, between tickets, and it also caps how long the next session may run.
function budgetLeft(loop) {
  const { hours, tokens } = loop.budget;
  if (hours !== undefined && loop.usedMs >= hours * 3600 * 1000) return false;
  if (tokens !== undefined && loop.usedTokens >= tokens) return false;
  return true;
}

function sessionTimeout(loop) {
  if (loop.budget.hours === undefined) return undefined;
  return Math.max(1000, loop.budget.hours * 3600 * 1000 - loop.usedMs);
}

// A session's output is one JSON result, or a stream of JSON events ending in one. The stream
// can also say how much of the plan's usage is gone. A Host that doesn't report this leaves
// `limit` null, and a run simply can't pause early.
function readEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Not an event. Anything a Host prints around its events is ignored.
    }
  }
  return events;
}

function readLimit(events) {
  const latest = events.filter((event) => event.type === 'rate_limit_event').pop();
  if (!latest || !latest.rate_limit_info) return null;
  const info = latest.rate_limit_info;
  const windows = Object.entries(info.unifiedWindows || {}).map(([name, window]) => ({ name, ...window }));
  // The reported status counts as well as the number, because the Host may refuse before 100%.
  const hit = windows.filter((window) => window.utilization >= LIMIT_THRESHOLD || (window.status && window.status !== 'allowed'));
  if (hit.length > 0) {
    const longest = hit.reduce((a, b) => ((a.resetsAt || 0) >= (b.resetsAt || 0) ? a : b));
    return { name: longest.name, utilization: longest.utilization, resetsAt: longest.resetsAt };
  }
  if (info.status && info.status !== 'allowed') {
    return { name: info.rateLimitType || 'unknown', utilization: null, resetsAt: info.resetsAt };
  }
  return null;
}

function parseSession(stdout) {
  const events = readEvents(stdout);
  const parsed = [...events].reverse().find((event) => 'result' in event || event.type === 'result');
  const limit = readLimit(events);
  let result = stdout;
  let tokens = 0;
  let isError = true;
  if (parsed) {
    result = String(parsed.result ?? '');
    isError = parsed.is_error === true;
    const usage = parsed.usage || {};
    tokens = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens'].reduce((sum, key) => sum + (usage[key] || 0), 0);
  }
  const lines = result.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const resultIndex = lines.findLastIndex((line) => /^OURKIT-RESULT:/.test(line));
  const named = resultIndex >= 0 ? lines[resultIndex].replace(/^OURKIT-RESULT:\s*/, '').trim() : '';
  const before = resultIndex >= 0 ? lines.slice(0, resultIndex) : lines;
  return {
    tokens,
    isError,
    limit,
    outcome: OUTCOMES.includes(named) ? named : 'unknown',
    summary: before.slice(-SUMMARY_LINES).join('\n'),
  };
}

// ADR 0011: only Lessons and the Project Log carry over, and they travel by file, not by context.
// They're on the ticket's branch, so they're read before leaving it and restored on the way back.
function returnToDefault(projectDir, main) {
  const branch = git(projectDir, ['branch', '--show-current']).output;
  const carried = CARRIED.map((relative) => {
    const file = path.join(projectDir, relative);
    return { file, content: fs.existsSync(file) ? fs.readFileSync(file) : null };
  });
  if (git(projectDir, ['status', '--porcelain']).output) {
    // Carried files are expected to be uncommitted on the default branch, since they're put there on purpose.
    const excludingCarried = git(projectDir, ['status', '--porcelain', '--', '.', ...CARRIED.map((file) => `:(exclude)${file.replace(/\\/g, '/')}`)]).output;
    if (branch === main && excludingCarried) {
      const files = excludingCarried.split('\n').map((line) => line.slice(3)).join(', ');
      return { error: `the session left uncommitted work on ${main}: ${files}` };
    }
  }
  if (branch !== main && git(projectDir, ['status', '--porcelain']).output) {
    // A stopped ticket has work worth keeping, so it's saved on that ticket's own branch.
    git(projectDir, ['add', '-A']);
    if (!git(projectDir, ['-c', 'user.name=ourkit', '-c', 'user.email=ourkit@localhost', 'commit', '-q', '-m', 'chore: save work from a stopped Loop Run session']).ok) {
      return { error: `couldn't save the session's work on ${branch}` };
    }
  }
  if (branch !== main && !git(projectDir, ['switch', '-q', main]).ok) {
    return { error: `couldn't return to ${main}` };
  }
  for (const { file, content } of carried) {
    if (content !== null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  return {};
}

// Moves to a ticket's saved branch, taking the carried files along. They're uncommitted on the
// default branch and may be committed on the ticket's branch too, so git can't switch with them in place.
function switchCarrying(projectDir, branch) {
  const carried = CARRIED.map((relative) => {
    const file = path.join(projectDir, relative);
    return { relative, file, content: fs.existsSync(file) ? fs.readFileSync(file) : null };
  });
  for (const { relative, file, content } of carried) {
    if (content === null) continue;
    const tracked = git(projectDir, ['ls-files', '--error-unmatch', '--', relative.replace(/\\/g, '/')]).ok;
    if (tracked) git(projectDir, ['checkout', '-q', '--', relative.replace(/\\/g, '/')]);
    else fs.rmSync(file);
  }
  const switched = git(projectDir, ['switch', '-q', branch]).ok;
  for (const { file, content } of carried) {
    if (content !== null) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  }
  return switched;
}

// On timeout the whole process tree must go. Killing only the shell would leave an agent
// running unattended and past its Budget, which is exactly what the Budget exists to prevent.
function killTree(child) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

function runSession(session, projectDir, input, timeout) {
  return new Promise((resolve) => {
    const child = spawn(session.command, session.args, {
      cwd: projectDir,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = timeout === undefined ? null : setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeout);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve({ status: 1, stdout, stderr, timedOut });
    });
    child.on('close', (status) => {
      if (timer) clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

async function runLoop(projectDir, loop, options = {}) {
  const main = defaultBranch(projectDir);
  const session = sessionCommand(projectDir);
  const stop = (reason) => {
    loop.stopped = reason;
    writeLoop(projectDir, loop);
    return loop;
  };
  if (!main) return stop('no-default-branch');
  if (!session) return stop('no-session-command');

  loop.stopped = null;
  while (loop.queue.length > 0) {
    if (!budgetLeft(loop)) return stop('budget');
    const item = loop.queue[0];
    const started = Date.now();
    // Recorded first, so a run killed mid-session can tell which ticket it left half done.
    loop.running = item;
    writeLoop(projectDir, loop);
    const wanted = loop.resume && loop.resume.item === item ? loop.resume.branch : null;
    const resumeBranch = wanted && switchCarrying(projectDir, wanted) ? wanted : null;
    const result = await runSession(session, projectDir, promptFor(item, resumeBranch), sessionTimeout(loop));
    delete loop.running;
    loop.usedMs += Date.now() - started;
    const parsed = parseSession(result.stdout);
    loop.usedTokens += parsed.tokens;

    const onBranch = git(projectDir, ['branch', '--show-current']).output;
    const branch = onBranch && onBranch !== main ? onBranch : null;
    const back = returnToDefault(projectDir, main);
    // A ticket that stays queued keeps its branch, so the next session carries on there.
    loop.resume = branch ? { item, branch } : resumeBranch ? loop.resume : undefined;
    if (back.error) {
      loop.results.push({ item, branch, outcome: parsed.outcome, summary: [back.error, parsed.summary].filter(Boolean).join('\n') });
      loop.queue.shift();
      return stop('dirty-tree');
    }
    if (result.timedOut) return stop('budget');
    // The ticket stays queued, because a failed session may only mean a limit was reached.
    const failed = result.status !== 0 || parsed.isError;
    if (failed && !parsed.limit) {
      loop.lastError = parsed.summary.slice(0, 500) || result.stderr.slice(0, 500);
      return stop('session-failed');
    }
    if (!failed) {
      loop.results.push({ item, branch, outcome: parsed.outcome, summary: parsed.summary });
      loop.queue.shift();
      delete loop.resume;
    }
    writeLoop(projectDir, loop);
    if (!parsed.limit) continue;

    // Close to the plan's limit: take no new ticket, warn, and carry on after it refreshes if allowed.
    loop.limit = parsed.limit;
    if (loop.queue.length === 0) break;
    const when = parsed.limit.resetsAt ? new Date(parsed.limit.resetsAt * 1000).toLocaleString() : 'an unknown time';
    console.log(`ourkit: warning: the ${parsed.limit.name} usage limit is close, so no new ticket will start. It refreshes at ${when}.`);
    const waitMs = parsed.limit.resetsAt ? parsed.limit.resetsAt * 1000 - Date.now() + WAIT_MARGIN_MS : null;
    if (!options.wait || waitMs === null || waitMs > MAX_WAIT_MS) return stop('waiting-for-limit');
    await new Promise((resolve) => { setTimeout(resolve, Math.max(0, waitMs)); });
    console.log('ourkit: the usage limit has refreshed, so the run is continuing.');
  }
  const anyShipped = loop.results.some(({ outcome }) => outcome === 'shipped');
  return stop(anyShipped ? 'done' : 'all-blocked');
}

function parseStart(args) {
  const options = { items: [] };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--hours' || args[i] === '--tokens') options[args[i].slice(2)] = Number(args[(i += 1)]);
    else if (args[i] === '--wait') options.wait = true;
    else options.items.push(args[i]);
  }
  return options;
}

const USAGE = 'usage: ourkit loop <status | run [--hours <n>] [--tokens <n>] [--wait] <ticket-or-request>...>';

async function main(args) {
  const [action, ...rest] = args;
  const projectDir = process.cwd();
  if (action === 'status') {
    console.log(JSON.stringify(readLoop(projectDir), null, 2));
    return 0;
  }
  if (action !== 'run') {
    console.error(USAGE);
    return 2;
  }
  const { hours, tokens, items, wait } = parseStart(rest);
  for (const value of [hours, tokens]) {
    if (value !== undefined && !(value > 0)) {
      console.error('ourkit: a Budget must be a number above zero');
      return 2;
    }
  }
  let loop = readLoop(projectDir);
  if (items.length > 0) {
    if (hours === undefined && tokens === undefined) {
      console.error('ourkit: a Loop Run needs a Budget before it starts; use --hours or --tokens (ADR 0009)');
      return 2;
    }
    if (loop && loop.queue.length > 0) {
      console.error('ourkit: a Loop Run still has tickets queued; run `ourkit loop run` to continue it, or delete .ourkit/loop.json to drop it');
      return 1;
    }
    const budget = { ...(hours !== undefined ? { hours } : {}), ...(tokens !== undefined ? { tokens } : {}) };
    loop = { budget, usedMs: 0, usedTokens: 0, queue: items, results: [], stopped: null };
  } else if (!loop || loop.queue.length === 0) {
    console.error(USAGE);
    return 2;
  }
  const main_ = defaultBranch(projectDir);
  const current = git(projectDir, ['branch', '--show-current']).output;
  if (items.length === 0 && loop.running && main_ && current && current !== main_) {
    // The last run was killed mid-session, so its work is saved where a finished session's would be.
    const back = returnToDefault(projectDir, main_);
    if (back.error) {
      console.error(`ourkit: ${back.error}`);
      return 1;
    }
    loop.resume = { item: loop.running, branch: current };
    console.log(`ourkit: the last run stopped during ${loop.running}, so its work is saved on ${current} and that ticket carries on there.`);
  }
  delete loop.running;
  if (main_ && git(projectDir, ['branch', '--show-current']).output !== main_) {
    console.error(`ourkit: start a Loop Run from ${main_}, because each ticket branches from it`);
    return 1;
  }
  keepStateOutOfGit(projectDir);
  const dirty = git(projectDir, ['status', '--porcelain', '--', '.', ...CARRIED.map((file) => `:(exclude)${file.replace(/\\/g, '/')}`)]).output;
  if (dirty) {
    console.error('ourkit: commit or stash your work first, because a Loop Run moves between branches');
    return 1;
  }
  writeLoop(projectDir, loop);
  const finished = await runLoop(projectDir, loop, { wait });
  const report = writeReport(projectDir, finished).replace(/\\/g, '/');
  console.log(JSON.stringify({ stopped: finished.stopped, finished: finished.results.length, queued: finished.queue.length, usedTokens: finished.usedTokens, report }, null, 2));
  return ['done', 'all-blocked', 'budget', 'waiting-for-limit'].includes(finished.stopped) ? 0 : 1;
}

module.exports = { LOOP_PATH, budgetLeft, main, parseSession, readLoop };
