// The documents a change produces on its way through the Stages, and what each must contain.
const fs = require('fs');
const path = require('path');
const { assess, parseFields } = require('./ticket-standard');

const ARTIFACTS = {
  spec: { folder: 'specs', sections: ['Goal', 'Requirements', 'Acceptance Criteria', 'Out of Scope', 'Open Questions'] },
  plan: { folder: 'plans', sections: ['Approach', 'Prior Art', 'Changes', 'Risks', 'Test Strategy'] },
  tasks: { folder: 'tasks', sections: ['Tasks'], check: checkTasks },
  report: { folder: 'reports', sections: ['Summary', 'Details'], check: checkReport },
  epic: { folder: 'epics', sections: [], check: checkEpic },
  bug: { folder: 'bugs', sections: ['Symptom', 'Reproduction', 'Root Cause', 'Fix', 'Verification'] },
};

const relativePathFor = (name, id) =>
  path.join('.ourkit', ARTIFACTS[name].folder, `${id.replace(/[^A-Za-z0-9._-]/g, '-')}.md`);

const readDocument = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// Reads "### 1. Title" blocks, each with "Depends on:" and "Verify:" lines.
function parseTasks(text) {
  const tasks = [];
  const pattern = /^### (\d+)\.[ \t]*(.*)$/gm;
  const matches = [...text.matchAll(pattern)];
  matches.forEach((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const body = text.slice(match.index + match[0].length, end);
    const dependsLine = body.match(/^Depends on:[ \t]*(.*)$/m);
    const verifyLine = body.match(/^Verify:[ \t]*(.*)$/m);
    tasks.push({
      id: Number(match[1]),
      title: match[2].trim(),
      dependsOn: dependsLine ? [...dependsLine[1].matchAll(/\d+/g)].map((n) => Number(n[0])) : null,
      verify: verifyLine ? verifyLine[1].trim() : '',
    });
  });
  return tasks;
}

function findCycle(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const done = new Set();
  const visit = (id, trail) => {
    if (trail.includes(id)) return [...trail.slice(trail.indexOf(id)), id];
    if (done.has(id) || !byId.has(id)) return null;
    for (const next of byId.get(id).dependsOn || []) {
      const cycle = visit(next, [...trail, id]);
      if (cycle) return cycle;
    }
    done.add(id);
    return null;
  };
  for (const task of tasks) {
    const cycle = visit(task.id, []);
    if (cycle) return cycle;
  }
  return null;
}

function checkTasks(text) {
  const tasks = parseTasks(text);
  if (tasks.length === 0) return ['there are no tasks; write each as "### 1. Title"'];
  const problems = [];
  const ids = tasks.map((task) => task.id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (repeated.length > 0) problems.push(`task numbers repeat: ${[...new Set(repeated)].join(', ')}`);
  for (const task of tasks) {
    if (!task.title) problems.push(`task ${task.id} has no title`);
    if (task.dependsOn === null) problems.push(`task ${task.id} needs a "Depends on:" line, using "none" if nothing`);
    if (!task.verify) problems.push(`task ${task.id} needs a "Verify:" line`);
    for (const dependency of task.dependsOn || []) {
      if (!ids.includes(dependency)) problems.push(`task ${task.id} depends on task ${dependency}, which doesn't exist`);
    }
  }
  const cycle = findCycle(tasks);
  if (cycle) problems.push(`tasks depend on each other in a circle: ${cycle.join(' -> ')}`);
  return problems;
}

function checkReport(text) {
  const summary = text.match(/^## Summary[ \t]*\n([\s\S]*?)(?=^## )/m);
  const lines = summary ? summary[1].split('\n').filter((line) => line.trim()).length : 0;
  return lines === 5 ? [] : [`the Summary must be exactly 5 lines, and it has ${lines}`];
}

// Every Feature must itself meet the Ticket Standard, and dependencies must form an order.
function checkEpic(text) {
  const matches = [...text.matchAll(/^## F(\d+)[ \t]+(.*)$/gm)];
  if (matches.length === 0) return ['there are no Features; write each as "## F1 Title"'];
  const problems = [];
  const features = matches.map((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const body = text.slice(match.index + match[0].length, end).trim();
    const blockedBy = (parseFields(body)['Blocked by'] || '');
    return { id: Number(match[1]), title: match[2].trim(), body, dependsOn: [...blockedBy.matchAll(/F(\d+)/g)].map((m) => Number(m[1])) };
  });
  const ids = features.map((feature) => feature.id);
  const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (repeated.length > 0) problems.push(`Feature numbers repeat: ${[...new Set(repeated)].map((id) => `F${id}`).join(', ')}`);
  for (const feature of features) {
    for (const { criterion, message } of assess({ title: feature.title, body: feature.body })) {
      problems.push(`F${feature.id}: [${criterion}] ${message}`);
    }
    if (!/^\*\*Blocked by:\*\*/m.test(feature.body)) problems.push(`F${feature.id} needs a "Blocked by:" line, using "none" if nothing`);
    for (const dependency of feature.dependsOn) {
      if (!ids.includes(dependency)) problems.push(`F${feature.id} is blocked by F${dependency}, which doesn't exist`);
    }
  }
  const cycle = findCycle(features);
  if (cycle) problems.push(`Features block each other in a circle: ${cycle.map((id) => `F${id}`).join(' -> ')}`);
  return problems;
}

// Returns what's wrong with an artifact, as a list of problems.
function checkArtifact(projectDir, name, id) {
  const relative = relativePathFor(name, id);
  const file = path.join(projectDir, relative);
  if (!fs.existsSync(file)) return [`${relative.replace(/\\/g, '/')} doesn't exist yet`];
  const text = readDocument(file);
  const problems = [];
  for (const section of ARTIFACTS[name].sections) {
    const match = text.match(new RegExp(`^## ${section}[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
    if (!match) problems.push(`the "${section}" section is missing`);
    else if (!match[1].trim()) problems.push(`the "${section}" section is empty`);
  }
  if (problems.length === 0 && ARTIFACTS[name].check) problems.push(...ARTIFACTS[name].check(text));
  return problems;
}

module.exports = { ARTIFACTS, checkArtifact, parseTasks, readDocument, relativePathFor };
