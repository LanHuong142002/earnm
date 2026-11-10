// QA: checking the running change against each Acceptance Criterion in its spec, after Review and before Ship.
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { readDocument, relativePathFor } = require('./artifacts');
const { readChange, updateChange } = require('./change-state');
const { actionFor, gateScope, severityFor } = require('./gate');
const { fingerprint } = require('./review');
const { lookupCommand } = require('./stack-profile');

const RESULTS = ['pass', 'fail', 'manual'];

// Only a Feature has QA: a Patch has no spec, and a Bug-fix checks its fix in Verify.
const qaRequired = (record) => record.flow !== 'bug-fix' && record.tier === 'feature';

// Each list item under "## Acceptance Criteria", in order. A wrapped line belongs to the item above it.
// Criteria written as prose, with no list, count as one criterion.
function acceptanceCriteria(projectDir, id) {
  const file = path.join(projectDir, relativePathFor('spec', id));
  if (!fs.existsSync(file)) return [];
  const match = readDocument(file).match(/^## Acceptance Criteria[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!match) return [];
  const criteria = [];
  for (const line of match[1].split('\n')) {
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*\S)/);
    if (item) criteria.push(item[1]);
    else if (line.trim() && criteria.length > 0) criteria[criteria.length - 1] += ` ${line.trim()}`;
  }
  if (criteria.length === 0 && match[1].trim()) criteria.push(match[1].trim().replace(/s+/g, ' '));
  return criteria;
}

function qaGate(projectDir, record, change) {
  const pass = { status: 'pass', severity: 'none', action: 'continue' };
  if (!qaRequired(record)) return { ...pass, reason: 'only a Feature has QA' };
  const criteria = acceptanceCriteria(projectDir, change.id);
  const qa = record.qa || {};
  const results = qa.results || {};
  const problems = [];
  if (criteria.length === 0) problems.push('the spec lists no Acceptance Criteria to check');
  const unchecked = criteria.map((_, index) => index + 1).filter((n) => !results[n]);
  if (unchecked.length > 0) problems.push(`these Acceptance Criteria haven't been checked: ${unchecked.join(', ')}`);
  const failed = Object.keys(results).filter((n) => results[n].result === 'fail');
  if (failed.length > 0) problems.push(`these Acceptance Criteria failed: ${failed.join(', ')}`);
  if (problems.length === 0) {
    if (!qa.checked) problems.push('QA has not been completed yet');
    else if (qa.checked !== fingerprint(projectDir, gateScope(projectDir, change))) problems.push('the change has moved since QA, so check it again');
  }
  if (problems.length === 0) return pass;
  const severity = severityFor(record);
  return { status: 'fail', reason: problems.join('; '), problems, severity, action: actionFor(severity, record) };
}

// A Markdown table for the Change Report and the PR's How To Verify.
function table(criteria, results) {
  const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const mark = { pass: '✅ pass', fail: '❌ fail', manual: '🙋 by hand' };
  const rows = criteria.map((criterion, index) => {
    const entry = results[index + 1];
    return `| ${index + 1} | ${cell(criterion)} | ${entry ? cell(entry.evidence) : '—'} | ${entry ? mark[entry.result] : 'not checked'} |`;
  });
  return ['| # | Acceptance Criterion | How it was checked | Result |', '|---|---|---|---|', ...rows].join('\n');
}

function fail(message, code = 2) {
  console.error(`ourkit: ${message}`);
  return code;
}

function main(args) {
  const [action, first, second, third] = args;
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) return fail(`no Active Change: ${change.error}`, 1);
  const record = readChange(projectDir, change.id);
  const qa = record.qa || { results: {} };
  const results = qa.results || {};
  const criteria = acceptanceCriteria(projectDir, change.id);

  if (action === 'criteria') {
    const commands = Object.fromEntries(['run', 'smoke', 'test'].map((name) => {
      try {
        const lookup = lookupCommand(projectDir, name);
        return [name, lookup.found ? lookup.command : null];
      } catch {
        return [name, null];
      }
    }));
    console.log(JSON.stringify({ required: qaRequired(record), criteria: criteria.map((text, index) => ({ n: index + 1, text })), commands }, null, 2));
    return 0;
  }
  if (action === 'check' && first && RESULTS.includes(second) && third && third.trim()) {
    const n = Number(first);
    if (!Number.isInteger(n) || n < 1 || n > criteria.length) return fail(`no Acceptance Criterion ${first}; the spec has ${criteria.length}`, 1);
    const entry = { result: second, evidence: third.trim(), criterion: criteria[n - 1] };
    updateChange(projectDir, change.id, { qa: { ...qa, results: { ...results, [n]: entry } } });
    console.log(`ourkit: recorded criterion ${n} as ${second}`);
    return 0;
  }
  if (action === 'list') {
    console.log(JSON.stringify(criteria.map((text, index) => ({ n: index + 1, text, ...(results[index + 1] || { result: null }) })), null, 2));
    return 0;
  }
  if (action === 'table') {
    console.log(table(criteria, results));
    return 0;
  }
  if (action === 'complete') {
    const unchecked = criteria.map((_, index) => index + 1).filter((n) => !results[n]);
    if (criteria.length === 0) return fail('the spec lists no Acceptance Criteria to check', 1);
    if (unchecked.length > 0) return fail(`check every Acceptance Criterion first; not checked: ${unchecked.join(', ')}`, 1);
    const failed = Object.keys(results).filter((n) => results[n].result === 'fail');
    if (failed.length > 0) return fail(`fix the failed Acceptance Criteria first, then check them again: ${failed.join(', ')}`, 1);
    updateChange(projectDir, change.id, { qa: { ...qa, checked: fingerprint(projectDir, gateScope(projectDir, change)) } });
    console.log('ourkit: recorded QA of the change as it now stands');
    return 0;
  }
  return fail('usage: ourkit qa <criteria | check <n> <pass|fail|manual> "<how it was checked and what you saw>" | list | table | complete>');
}

module.exports = { acceptanceCriteria, main, qaGate, qaRequired };
