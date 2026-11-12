// Mockups and Prototypes: a static picture of what people will see, agreed before anything is built,
// so a wrong screen costs an edit instead of a rebuilt feature. A Feature gets a Mockup: one HTML file
// for its own screens, made in Plan. An Epic gets a Prototype: the whole product, clickable with
// made-up data, made after the Grill and before the split, so every Feature builds toward one design.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { readChange, updateChange } = require('./change-state');
const { INSTALL_RECORD, hashFile } = require('./install');

const safe = (id) => id.replace(/[^A-Za-z0-9._-]/g, '-');
const isEpic = (record) => (record || {}).tier === 'epic';
const nounFor = (record) => (isEpic(record) ? 'prototype' : 'mockup');
const commandFor = (record) => `ourkit ${nounFor(record)}`;
const toPosix = (p) => p.replace(/\\/g, '/');

// A Prototype is a folder, so a large product can be split into files that are edited one at a time.
const relativeMockupPath = (id, record) => (isEpic(record)
  ? path.join('.ourkit', 'prototypes', safe(id), 'index.html')
  : path.join('.ourkit', 'mockups', `${safe(id)}.html`));
const mockupFile = (projectDir, id, record) => path.join(projectDir, relativeMockupPath(id, record));

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

// What an approval is tied to: the file, or for a Prototype every file in its folder.
function hashMockup(projectDir, id, record) {
  const file = mockupFile(projectDir, id, record);
  if (!isEpic(record)) return hashFile(file);
  const dir = path.dirname(file);
  const lines = filesUnder(dir).map((f) => `${toPosix(path.relative(dir, f))}:${hashFile(f)}`).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

// A project with the frontend Role must decide for every Feature and Epic whether it needs one.
function frontendEnabled(projectDir) {
  const file = path.join(projectDir, INSTALL_RECORD);
  if (!fs.existsSync(file)) return false;
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')).roles || []).includes('frontend');
  } catch {
    return false;
  }
}

// A Feature plan approved before mockups existed. An Epic has no such approval to keep, and deciding
// `ourkit prototype need no --reason "split before prototypes existed"` costs one line.
const approvedBefore = (record) => !isEpic(record) && Boolean(record.planApproval);

// Why the work can't move past the picture yet, or null.
function mockupProblem(projectDir, record, id) {
  const { mockup } = record;
  const noun = nounFor(record);
  const command = commandFor(record);
  if (!mockup) {
    // Work approved before this existed stays approved, so an upgrade never stops work in progress.
    return frontendEnabled(projectDir) && !approvedBefore(record)
      ? `decide whether this change needs a ${noun} first: \`${command} need yes\`, or \`${command} need no --reason "<why>"\``
      : null;
  }
  if (!mockup.needed) return null;
  if (!fs.existsSync(mockupFile(projectDir, id, record))) {
    return `the ${noun} doesn't exist yet; write it at ${toPosix(relativeMockupPath(id, record))}`;
  }
  if (!record.mockupApproval) return `the user has not approved the ${noun} yet`;
  if (record.mockupApproval !== hashMockup(projectDir, id, record)) return `the ${noun} changed after the user approved it, so it needs approving again`;
  return null;
}

function state(projectDir, record, id) {
  const exists = fs.existsSync(mockupFile(projectDir, id, record));
  const needed = record.mockup ? record.mockup.needed : null;
  return {
    kind: nounFor(record),
    needed,
    reason: record.mockup ? record.mockup.reason || null : null,
    path: toPosix(relativeMockupPath(id, record)),
    exists,
    approved: Boolean(needed && exists && record.mockupApproval && record.mockupApproval === hashMockup(projectDir, id, record)),
    decisionRequired: !record.mockup && frontendEnabled(projectDir),
  };
}

// `ourkit mockup` and `ourkit prototype` are the same command; the change's Tier decides which it is.
function main(args, asked = 'mockup') {
  const [action, value, flag, reason] = args;
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) {
    console.error(`ourkit: no Active Change: ${change.error}`);
    return 1;
  }
  const record = readChange(projectDir, change.id);
  const noun = nounFor(record);
  const command = commandFor(record);
  if (asked !== noun) {
    console.error(`ourkit: ${isEpic(record) ? 'an Epic has a prototype' : 'only an Epic has a prototype; this change has a mockup'}, so use \`${command}\``);
    return 2;
  }
  const where = toPosix(relativeMockupPath(change.id, record));
  if (action === 'path') {
    console.log(where);
    return 0;
  }
  if (action === 'show' || action === undefined) {
    console.log(JSON.stringify(state(projectDir, record, change.id), null, 2));
    return 0;
  }
  if (action === 'need' && value === 'yes') {
    updateChange(projectDir, change.id, { mockup: { needed: true, reason: null } });
    const before = isEpic(record) ? 'before the Epic is split into Features' : 'before Build';
    console.log(`ourkit: this change needs a ${noun} the user approves ${before}; write it at ${where}`);
    return 0;
  }
  if (action === 'need' && value === 'no') {
    if (flag !== '--reason' || !reason || !reason.trim()) {
      console.error(`ourkit: say why no ${noun} is needed: ${command} need no --reason "<why>"`);
      return 2;
    }
    updateChange(projectDir, change.id, { mockup: { needed: false, reason: reason.trim() }, mockupApproval: null });
    console.log(`ourkit: this change needs no ${noun}`);
    return 0;
  }
  if (action === 'approve') {
    if (!record.mockup || !record.mockup.needed) {
      console.error(`ourkit: this change has no ${noun} to approve; run \`${command} need yes\` first`);
      return 1;
    }
    if (!fs.existsSync(mockupFile(projectDir, change.id, record))) {
      console.error(`ourkit: the ${noun} doesn't exist yet; write it at ${where}`);
      return 1;
    }
    updateChange(projectDir, change.id, { mockupApproval: hashMockup(projectDir, change.id, record) });
    console.log(`ourkit: recorded the user's approval of this version of the ${noun}`);
    return 0;
  }
  console.error(`usage: ${command} <show | path | need yes | need no --reason "<why>" | approve>`);
  return 2;
}

module.exports = { main, mockupProblem, relativeMockupPath, state };
