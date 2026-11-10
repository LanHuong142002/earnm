// The Gate into Ship: everything that must be true before a PR opens.
const { spawnSync } = require('child_process');
const path = require('path');
const { checkArtifact, parseTasks, readDocument, relativePathFor } = require('./artifacts');
const { updateChange } = require('./change-state');
const { actionFor, gateScope } = require('./gate');
const { intakeProblem, stopRequired } = require('./handsoff');
const { modeOf } = require('./mode');
const { reportRequired } = require('./report');
const { fingerprint, reviewGate } = require('./review');
const { summarize } = require('./tasks');

const KIT_EXCLUDES = [':(exclude).ourkit', ':(exclude).claude'];

function uncommitted(projectDir) {
  const result = spawnSync('git', ['status', '--porcelain', '--', '.', ...KIT_EXCLUDES], { cwd: projectDir, encoding: 'utf8' });
  return (result.stdout || '').split('\n').filter(Boolean).length;
}

function shipGate(projectDir, record, change) {
  const problems = [];
  if (change.kind !== 'branch') problems.push('the change must be on its own branch, not the default branch');
  if (uncommitted(projectDir) > 0) problems.push('there is uncommitted work, so commit it first');

  const review = reviewGate(projectDir, record, change);
  if (review.status !== 'pass') problems.push(review.reason);

  // Required here because src/qa.js builds on src/review.js.
  const qa = require('./qa').qaGate(projectDir, record, change);
  if (qa.status !== 'pass') problems.push(...qa.problems.map((problem) => `QA: ${problem}`));

  if (record.flow === 'bug-fix') {
    problems.push(...checkArtifact(projectDir, 'bug', change.id).map((problem) => `Bug-fix notes: ${problem}`));
  } else if (record.tier !== 'patch') {
    const taskProblems = checkArtifact(projectDir, 'tasks', change.id);
    if (taskProblems.length > 0) {
      problems.push(...taskProblems);
    } else {
      const tasks = parseTasks(readDocument(path.join(projectDir, relativePathFor('tasks', change.id))));
      const { finished, blocked } = summarize(tasks, record.taskStatus || {});
      if (blocked.length > 0) problems.push(`these tasks are blocked: ${blocked.join(', ')}`);
      else if (!finished) problems.push('some tasks are not finished');
    }
  }
  if (reportRequired(record)) {
    problems.push(...checkArtifact(projectDir, 'report', change.id).map((problem) => `Change Report: ${problem}`));
  }

  // ADR 0012: in Hands-off, the second stop. Everything above is settled first, so the user approves finished work.
  let waitingForUser = false;
  if (modeOf(record) === 'hands-off') {
    const intake = intakeProblem(record);
    if (intake) {
      problems.push(intake);
      waitingForUser = true;
    } else if (stopRequired(record)) {
      const current = fingerprint(projectDir, gateScope(projectDir, change));
      if (record.shipApproval !== current) {
        problems.push(record.shipApproval ? 'the change moved after the user approved it, so it needs approving again' : 'the user must approve this change before Ship');
        waitingForUser = true;
      }
    }
  }
  if (problems.length === 0) return { status: 'pass', severity: 'none', action: 'continue' };
  return { status: 'fail', problems, severity: 'block', action: waitingForUser ? 'stop-for-user' : actionFor('block', record) };
}

// Recorded only when the rest of the Gate passes, so approval always means approving finished work.
function approveShip(projectDir, record, change) {
  const { problems = [] } = shipGate(projectDir, { ...record, mode: 'pair' }, change);
  if (problems.length > 0) {
    console.error(`ourkit: this change isn't ready for approval: ${problems.join('; ')}`);
    return 1;
  }
  updateChange(projectDir, change.id, { shipApproval: fingerprint(projectDir, gateScope(projectDir, change)) });
  console.log("ourkit: recorded the user's approval of this change as it now stands");
  return 0;
}

module.exports = { approveShip, shipGate };
