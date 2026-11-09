// Gates: shared behaviour between Stages. Severity comes from the Tier, the action from the Mode.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { ARTIFACTS, checkArtifact, relativePathFor } = require('./artifacts');
const { readBaseline } = require('./baseline');
const { readChange, updateChange } = require('./change-state');
const { intakeProblem, stopRequired } = require('./handsoff');
const { hashFile } = require('./install');
const { modeOf } = require('./mode');
const { lookupCommand, InvalidStackProfile } = require('./stack-profile');
const { floorViolation, scanSensitive } = require('./tier');

const RUNNABLE = ['test', 'lint', 'build']; // Never `deploy` (ADR 0010) or `run`, which may not end.
const OUTPUT_LINES = 40;
const TIMEOUT_MS = 20 * 60 * 1000;
const ACTIONS = {
  block: { pair: 'ask-user', 'hands-off': 'fix-or-stop' },
  remind: { pair: 'mention', 'hands-off': 'log-decision' },
};

function git(projectDir, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: projectDir, encoding: 'utf8' });
  return { ok: result.status === 0, output: (result.stdout || '').trim() };
}

// ADR 0006: Gates never judge code from before the Baseline, so a branch
// started before the kit was installed is compared from the Baseline instead.
function gateScope(projectDir, change) {
  const baseline = readBaseline(projectDir);
  if (!baseline) return { base: change.base, files: change.files, baselined: false };
  // A base that isn't a commit is the empty tree, which is older than any Baseline.
  const baseIsCommit = git(projectDir, ['cat-file', '-t', change.base]).output === 'commit';
  const startedBefore = !baseIsCommit || git(projectDir, ['merge-base', '--is-ancestor', change.base, baseline.commit]).ok;
  if (!startedBefore) return { base: change.base, files: change.files, baselined: false };
  const tracked = git(projectDir, ['diff', '--name-only', baseline.commit]).output.split('\n');
  const inBaselineScope = new Set(tracked);
  const untracked = git(projectDir, ['ls-files', '--others', '--exclude-standard']).output.split('\n');
  for (const file of untracked) inBaselineScope.add(file);
  return { base: baseline.commit, files: change.files.filter((file) => inBaselineScope.has(file)), baselined: true };
}

// Below Feature, a problem only reminds. A Sensitive Area always blocks.
function severityFor(record) {
  const sensitive = (record.sensitiveAreas || []).length > 0;
  return record.tier === 'patch' && !sensitive ? 'remind' : 'block';
}

function decide(record, status) {
  if (status === 'pass') return { severity: 'none', action: 'continue' };
  // A command that doesn't exist says nothing against the change, so it never blocks (ADR 0002).
  const severity = status === 'not-run' ? 'remind' : severityFor(record);
  return { severity, action: ACTIONS[severity][modeOf(record)] };
}

function runCommand(projectDir, command) {
  const result = spawnSync(command, { cwd: projectDir, encoding: 'utf8', shell: true, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const lines = `${result.stdout || ''}${result.stderr || ''}`.trim().split(/\r?\n/);
  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  return { passed: result.status === 0, timedOut, output: lines.slice(-OUTPUT_LINES).join('\n') };
}

function fail(message, code = 2) {
  console.error(`ourkit: ${message}`);
  return code;
}

function runGate(projectDir, record, name) {
  const lookup = lookupCommand(projectDir, name);
  if (!lookup.found) {
    return { command: name, status: 'not-run', reason: lookup.reason, ...decide(record, 'not-run') };
  }
  const { passed, timedOut, output } = runCommand(projectDir, lookup.command);
  const status = passed ? 'pass' : 'fail';
  return { command: name, status, ...(timedOut ? { reason: 'timed out' } : {}), ...decide(record, status), output };
}

function floorGate(record, scope) {
  const violation = floorViolation(record.tier, record.sensitiveAreas || [], scanSensitive(scope.files), record.notSensitiveReason);
  if (!violation) return { status: 'pass', severity: 'none', action: 'continue' };
  // This one always blocks: being a Patch is exactly what is in question.
  return { status: 'fail', reason: `this change can't stay a Patch, because ${violation}`, severity: 'block', action: ACTIONS.block[modeOf(record)] };
}

// The next Stage can't start from a document that isn't complete, whatever the Tier.
function artifactGate(projectDir, record, id, name) {
  const problems = checkArtifact(projectDir, name, id);
  if (problems.length === 0) return { status: 'pass', severity: 'none', action: 'continue' };
  return { status: 'fail', problems, severity: 'block', action: ACTIONS.block[modeOf(record)] };
}

const planFile = (projectDir, id) => path.join(projectDir, relativePathFor('plan', id));

// In Pair, Build waits for the user to approve this exact plan (ADR 0008). Hands-off doesn't wait (ADR 0012).
function approvalGate(projectDir, record, id) {
  const pass = { status: 'pass', severity: 'none', action: 'continue' };
  const handsOff = modeOf(record) === 'hands-off';
  if (handsOff) {
    const problem = intakeProblem(record);
    if (problem) return { status: 'fail', reason: problem, severity: 'block', action: 'stop-for-user' };
    if (!stopRequired(record)) return { ...pass, reason: 'Hands-off does not wait for plan approval' };
  }
  const file = planFile(projectDir, id);
  let reason = null;
  if (!fs.existsSync(file)) reason = "the plan doesn't exist yet";
  else if (!record.planApproval) reason = 'the user has not approved the plan yet';
  else if (record.planApproval !== hashFile(file)) reason = 'the plan changed after the user approved it, so it needs approving again';
  if (!reason) return pass;
  return { status: 'fail', reason, severity: 'block', action: handsOff ? 'stop-for-user' : ACTIONS.block.pair };
}

function approvePlan(projectDir, id) {
  const problems = checkArtifact(projectDir, 'plan', id);
  if (problems.length > 0) return fail(`the plan can't be approved yet: ${problems.join('; ')}`, 1);
  updateChange(projectDir, id, { planApproval: hashFile(planFile(projectDir, id)) });
  console.log('ourkit: recorded the user\'s approval of this version of the plan');
  return 0;
}

function main(args) {
  const [action, name] = args;
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) return fail(`no Active Change: ${change.error}`, 1);
  const scope = gateScope(projectDir, change);
  if (action === 'scope') {
    console.log(JSON.stringify(scope, null, 2));
    return 0;
  }
  if (action === 'path' && Object.hasOwn(ARTIFACTS, name)) {
    console.log(relativePathFor(name, change.id).replace(/\\/g, '/'));
    return 0;
  }
  const record = readChange(projectDir, change.id);
  if (!record.tier) return fail('set a Tier first, because it decides how strict a Gate is; see `ourkit tier`');
  let result;
  if (action === 'floor') {
    result = floorGate(record, scope);
  } else if (action === 'artifact' && Object.hasOwn(ARTIFACTS, name)) {
    result = artifactGate(projectDir, record, change.id, name);
  } else if (action === 'review') {
    // Required here because src/review.js builds on this file.
    result = require('./review').reviewGate(projectDir, record, change);
  } else if (action === 'ship') {
    result = require('./ship').shipGate(projectDir, record, change);
  } else if (action === 'approval') {
    result = approvalGate(projectDir, record, change.id);
  } else if (action === 'approve-plan') {
    return approvePlan(projectDir, change.id);
  } else if (action === 'approve-ship') {
    return require('./ship').approveShip(projectDir, record, change);
  } else if (action === 'run' && RUNNABLE.includes(name)) {
    try {
      result = runGate(projectDir, record, name);
    } catch (error) {
      if (!(error instanceof InvalidStackProfile)) throw error;
      return fail(error.message);
    }
  } else {
    const documents = Object.keys(ARTIFACTS).join('|');
    return fail(`usage: ourkit gate <scope | floor | review | ship | approval | approve-plan | approve-ship | run <${RUNNABLE.join('|')}> | path <${documents}> | artifact <${documents}>>`);
  }
  console.log(JSON.stringify(result, null, 2));
  return result.severity === 'block' ? 1 : 0;
}

const actionFor = (severity, record) => ACTIONS[severity][modeOf(record)];

module.exports = { actionFor, decide, gateScope, main, severityFor };
