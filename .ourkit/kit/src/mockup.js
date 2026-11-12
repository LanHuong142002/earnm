// Mockups: for a change people will see, a static picture of it that the user agrees to before
// anything is built, so a wrong screen costs a mockup edit instead of a rebuilt feature.
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { readChange, updateChange } = require('./change-state');
const { INSTALL_RECORD, hashFile } = require('./install');

const USAGE = 'usage: ourkit mockup <show | path | need yes | need no --reason "<why>" | approve>';

const relativeMockupPath = (id) => path.join('.ourkit', 'mockups', `${id.replace(/[^A-Za-z0-9._-]/g, '-')}.html`);
const mockupFile = (projectDir, id) => path.join(projectDir, relativeMockupPath(id));

// A project with the frontend Role must decide for every Feature whether it needs a mockup.
function frontendEnabled(projectDir) {
  const file = path.join(projectDir, INSTALL_RECORD);
  if (!fs.existsSync(file)) return false;
  try {
    return (JSON.parse(fs.readFileSync(file, 'utf8')).roles || []).includes('frontend');
  } catch {
    return false;
  }
}

// Why the plan can't be approved yet because of the mockup, or null.
function mockupProblem(projectDir, record, id) {
  const { mockup } = record;
  if (!mockup) {
    // A plan approved before mockups existed stays approved, so an upgrade never stops work in progress.
    return frontendEnabled(projectDir) && !record.planApproval
      ? 'decide whether this change needs a mockup first: `ourkit mockup need yes`, or `ourkit mockup need no --reason "<why>"`'
      : null;
  }
  if (!mockup.needed) return null;
  const file = mockupFile(projectDir, id);
  if (!fs.existsSync(file)) return `the mockup doesn't exist yet; write it at ${relativeMockupPath(id).replace(/\\/g, '/')}`;
  if (!record.mockupApproval) return 'the user has not approved the mockup yet';
  if (record.mockupApproval !== hashFile(file)) return 'the mockup changed after the user approved it, so it needs approving again';
  return null;
}

function state(projectDir, record, id) {
  const file = mockupFile(projectDir, id);
  const exists = fs.existsSync(file);
  const needed = record.mockup ? record.mockup.needed : null;
  return {
    needed,
    reason: record.mockup ? record.mockup.reason || null : null,
    path: relativeMockupPath(id).replace(/\\/g, '/'),
    exists,
    approved: Boolean(needed && exists && record.mockupApproval && record.mockupApproval === hashFile(file)),
    decisionRequired: !record.mockup && frontendEnabled(projectDir),
  };
}

function main(args) {
  const [action, value, flag, reason] = args;
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) {
    console.error(`ourkit: no Active Change: ${change.error}`);
    return 1;
  }
  const record = readChange(projectDir, change.id);
  if (action === 'path') {
    console.log(relativeMockupPath(change.id).replace(/\\/g, '/'));
    return 0;
  }
  if (action === 'show' || action === undefined) {
    console.log(JSON.stringify(state(projectDir, record, change.id), null, 2));
    return 0;
  }
  if (action === 'need' && value === 'yes') {
    updateChange(projectDir, change.id, { mockup: { needed: true, reason: null } });
    console.log(`ourkit: this change needs a mockup the user approves before Build; write it at ${relativeMockupPath(change.id).replace(/\\/g, '/')}`);
    return 0;
  }
  if (action === 'need' && value === 'no') {
    if (flag !== '--reason' || !reason || !reason.trim()) {
      console.error('ourkit: say why no mockup is needed: ourkit mockup need no --reason "<why>"');
      return 2;
    }
    updateChange(projectDir, change.id, { mockup: { needed: false, reason: reason.trim() }, mockupApproval: null });
    console.log('ourkit: this change needs no mockup');
    return 0;
  }
  if (action === 'approve') {
    if (!record.mockup || !record.mockup.needed) {
      console.error('ourkit: this change has no mockup to approve; run `ourkit mockup need yes` first');
      return 1;
    }
    const file = mockupFile(projectDir, change.id);
    if (!fs.existsSync(file)) {
      console.error(`ourkit: the mockup doesn't exist yet; write it at ${relativeMockupPath(change.id).replace(/\\/g, '/')}`);
      return 1;
    }
    updateChange(projectDir, change.id, { mockupApproval: hashFile(file) });
    console.log("ourkit: recorded the user's approval of this version of the mockup");
    return 0;
  }
  console.error(USAGE);
  return 2;
}

module.exports = { main, mockupProblem, relativeMockupPath, state };
