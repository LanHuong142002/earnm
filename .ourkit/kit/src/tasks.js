// Progress through the tasks of the Active Change.
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { checkArtifact, parseTasks, readDocument, relativePathFor } = require('./artifacts');
const { readChange, updateChange } = require('./change-state');

// Blocked tasks hold back only what depends on them, so independent work carries on (ADR 0009).
function summarize(tasks, statuses) {
  const statusOf = (task) => (statuses[task.id] || { status: 'open' }).status;
  const isHeldBack = (task, seen = new Set()) =>
    task.dependsOn.some((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      const dependency = tasks.find((candidate) => candidate.id === id);
      return statusOf(dependency) === 'blocked' || isHeldBack(dependency, seen);
    });
  const withStatus = tasks.map((task) => ({ ...task, ...(statuses[task.id] || { status: 'open' }) }));
  const open = tasks.filter((task) => statusOf(task) === 'open');
  const ready = open.filter((task) => task.dependsOn.every((id) => statusOf(tasks.find((t) => t.id === id)) === 'done'));
  const heldBack = open.filter((task) => isHeldBack(task));
  return {
    tasks: withStatus,
    ready: ready.map((task) => task.id),
    heldBack: heldBack.map((task) => task.id),
    blocked: tasks.filter((task) => statusOf(task) === 'blocked').map((task) => task.id),
    finished: open.length === 0,
  };
}

function fail(message, code = 2) {
  console.error(`ourkit: ${message}`);
  return code;
}

function main(args) {
  const [action, value, reason] = args;
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) return fail(`no Active Change: ${change.error}`, 1);
  const problems = checkArtifact(projectDir, 'tasks', change.id);
  if (problems.length > 0) return fail(`the tasks aren't ready: ${problems.join('; ')}`, 1);
  const tasks = parseTasks(readDocument(path.join(projectDir, relativePathFor('tasks', change.id))));
  const statuses = readChange(projectDir, change.id).taskStatus || {};

  if (action === 'list') {
    console.log(JSON.stringify(summarize(tasks, statuses), null, 2));
    return 0;
  }
  if (action === 'done' || action === 'block') {
    if (!tasks.some((task) => String(task.id) === value)) return fail(`no task ${value}`, 1);
    if (action === 'block' && !(reason && reason.trim())) return fail('a blocked task needs a reason');
    const entry = action === 'done' ? { status: 'done' } : { status: 'blocked', reason: reason.trim() };
    updateChange(projectDir, change.id, { taskStatus: { ...statuses, [value]: entry } });
    console.log(`ourkit: task ${value} is ${entry.status}`);
    return 0;
  }
  if (action === 'reopen') {
    if (!tasks.some((task) => String(task.id) === value)) return fail(`no task ${value}`, 1);
    const { [value]: removed, ...rest } = statuses;
    updateChange(projectDir, change.id, { taskStatus: rest });
    console.log(`ourkit: task ${value} is open`);
    return 0;
  }
  return fail('usage: ourkit task <list | done <id> | block <id> "<reason>" | reopen <id>>');
}

module.exports = { main, summarize };
