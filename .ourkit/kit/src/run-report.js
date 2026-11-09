// Run Report: what a Loop Run did and what it needs from the user, gathered from each ticket's branch.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.join('.ourkit', 'run-report.md');
const STOP_MEANINGS = {
  done: 'The queue is empty, and at least one ticket shipped.',
  'all-blocked': 'The queue is empty, but no ticket shipped.',
  budget: 'The Budget ran out. Tickets left in the queue did not run.',
  'session-failed': 'A session failed, perhaps at a usage limit. Its ticket is still queued, and no work from that attempt is recorded here.',
  'dirty-tree': 'A session left uncommitted work on the default branch, so the run stopped rather than risk it.',
  'waiting-for-limit': 'The plan\'s usage limit is close, so the run paused before taking another ticket.',
};

// A branch's records are read from git, because the run has moved on from that branch.
function recordFromBranch(projectDir, branch) {
  if (!branch) return {};
  const id = branch.replace(/[^A-Za-z0-9._-]/g, '-');
  const result = spawnSync('git', ['show', `${branch}:.ourkit/changes/${id}.json`], { cwd: projectDir, encoding: 'utf8' });
  if (result.status !== 0) return {};
  try {
    return JSON.parse(result.stdout);
  } catch {
    return {};
  }
}

const bullets = (items) => (items.length > 0 ? items.join('\n') : 'None.');

function buildReport(projectDir, loop) {
  const gathered = loop.results.map((result) => ({ ...result, record: recordFromBranch(projectDir, result.branch) }));
  const forEach = (pick) => gathered.flatMap(({ item, record }) => pick(record).map((line) => `- **${item}:** ${line}`));

  const finished = gathered.map(({ item, outcome, branch, summary }) => [
    `### ${item}`,
    '',
    `Outcome: ${outcome}${branch ? ` on branch \`${branch}\`` : ''}`,
    '',
    summary || '(The session gave no summary.)',
  ].join('\n'));

  const waiting = [
    ...gathered.filter(({ outcome }) => outcome === 'shipped').map(({ item, branch }) => `- **${item}:** review and merge its PR (\`${branch}\`). Merging is your decision.`),
    ...gathered.filter(({ outcome }) => outcome === 'stopped').map(({ item, branch }) => `- **${item}:** waiting for your approval or answers on \`${branch}\`.`),
    ...gathered.filter(({ outcome }) => outcome === 'blocked').map(({ item }) => `- **${item}:** blocked; see its summary.`),
    ...gathered.filter(({ outcome }) => outcome === 'rejected').map(({ item }) => `- **${item}:** rejected at intake; it needs a team member to create or approve it.`),
    ...gathered.filter(({ outcome }) => outcome === 'unknown').map(({ item }) => `- **${item}:** the session didn't say how it ended, so check it yourself.`),
    ...loop.queue.map((item) => `- **${item}:** didn't finish, and is still queued. Run \`ourkit loop run\` to continue.`),
  ];

  const hours = (loop.usedMs / 3600000).toFixed(2);
  return [
    '# Run Report',
    '',
    `**Stopped:** ${loop.stopped}. ${STOP_MEANINGS[loop.stopped] || ''}`.trim(),
    `**Used:** ${hours} hours and ${loop.usedTokens} tokens, of a Budget of ${JSON.stringify(loop.budget)}.`,
    ...(loop.lastError ? [`**Last error:** ${loop.lastError}`] : []),
    ...(loop.stopped === 'waiting-for-limit' && loop.limit
      ? [`**Usage limit:** the ${loop.limit.name} limit refreshes at ${loop.limit.resetsAt ? new Date(loop.limit.resetsAt * 1000).toISOString() : 'an unknown time'}. Run \`ourkit loop run\` after that to continue.`]
      : []),
    '',
    '## Waiting for you',
    '',
    bullets(waiting),
    '',
    '## Question Batch',
    '',
    bullets(forEach((record) => (record.questions || []).filter((q) => q.answer === null).map((q) => q.question))),
    '',
    '## Test Handoff',
    '',
    bullets(forEach((record) => (record.testHandoff || []).map(({ what, steps }) => `${what} Steps: ${steps}`))),
    '',
    '## Decision Log',
    '',
    bullets(forEach((record) => (record.decisions || []).map(({ decision, why }) => `${decision} Why: ${why}`))),
    '',
    '## Non-blocking findings',
    '',
    bullets(forEach((record) => ((record.review || {}).findings || []).filter((f) => f.severity === 'non-blocking').map((f) => f.text))),
    '',
    '## Finished',
    '',
    finished.join('\n\n') || 'No ticket finished.',
    '',
  ].join('\n');
}

function writeReport(projectDir, loop) {
  const file = path.join(projectDir, REPORT_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildReport(projectDir, loop));
  return REPORT_PATH;
}

module.exports = { REPORT_PATH, buildReport, writeReport };
