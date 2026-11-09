// Review: what a Reviewer sees, its findings, and whether a change has been reviewed as it now stands.
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { relativePathFor } = require('./artifacts');
const { readChange, updateChange } = require('./change-state');
const { actionFor, gateScope, severityFor } = require('./gate');
const { hashFile } = require('./install');
const { resolveLayers } = require('./rules');

const SEVERITIES = ['blocking', 'non-blocking'];
const KIT_EXCLUDES = [':(exclude).ourkit', ':(exclude).claude'];
const UNTRACKED_MAX_BYTES = 100 * 1024;
const MAX_FIX_ATTEMPTS = 2;

function git(projectDir, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: projectDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return result.status === 0 ? result.stdout : '';
}

function untrackedFiles(projectDir, scope) {
  const inScope = new Set(scope.files);
  return git(projectDir, ['ls-files', '--others', '--exclude-standard']).split('\n').filter((file) => file && inScope.has(file));
}

// The whole change as text, including new files git doesn't track yet.
function changeText(projectDir, scope) {
  const diff = git(projectDir, ['diff', scope.base, '--', '.', ...KIT_EXCLUDES]);
  const added = untrackedFiles(projectDir, scope).map((file) => {
    const absolute = path.join(projectDir, file);
    const { size } = fs.statSync(absolute);
    const content = size > UNTRACKED_MAX_BYTES ? `(${size} bytes, too large to show)` : fs.readFileSync(absolute, 'utf8');
    return `--- new file: ${file}\n${content}`;
  });
  return [diff, ...added].join('\n').replace(/\r\n/g, '\n');
}

// Built from file contents rather than the diff, so that committing reviewed work doesn't count as moving it.
function fingerprint(projectDir, scope) {
  const entries = scope.files.map((file) => {
    const absolute = path.join(projectDir, file);
    return `${file}:${fs.existsSync(absolute) ? hashFile(absolute) : 'deleted'}`;
  });
  return crypto.createHash('sha256').update(entries.join('\n')).digest('hex');
}

function checklists(projectDir) {
  return resolveLayers(projectDir)
    .filter(({ layer, file }) => layer === 'Role' && path.basename(file) === 'checklist.md')
    .map(({ file }) => `<!-- ${path.relative(projectDir, file).replace(/\\/g, '/')} -->\n${fs.readFileSync(file, 'utf8').trim()}`);
}

// Everything a Reviewer may see: the spec, the diff and the checklists, and not how the work was done.
function packet(projectDir, change, record, scope) {
  // A Bug-fix has no spec, and its notes say what it must do.
  const document = record.flow === 'bug-fix' ? 'bug' : 'spec';
  const specFile = path.join(projectDir, relativePathFor(document, change.id));
  const spec = fs.existsSync(specFile) ? fs.readFileSync(specFile, 'utf8').trim() : `(This change has no ${document === 'bug' ? 'Bug-fix notes' : 'spec'}.)`;
  const sections = [
    `# Sensitive Areas\n\n${(record.sensitiveAreas || []).join(', ') || 'None declared.'}`,
    `# Spec\n\n${spec}`,
    `# Checklists\n\n${checklists(projectDir).join('\n\n') || '(No Role is enabled.)'}`,
    `# Diff\n\n${changeText(projectDir, scope)}`,
  ];
  return sections.join('\n\n');
}

function reviewGate(projectDir, record, change) {
  const review = record.review || {};
  const open = (review.findings || []).filter((finding) => finding.severity === 'blocking' && !finding.resolved);
  if (open.length > 0) {
    const reason = `${open.length} blocking finding(s) are unresolved`;
    return { status: 'fail', reason, findings: open, severity: 'block', action: actionFor('block', record) };
  }
  const scope = gateScope(projectDir, change);
  let reason = null;
  if (!review.reviewed) reason = 'this change has not been reviewed yet';
  else if (review.reviewed !== fingerprint(projectDir, scope)) reason = 'the change has moved since it was reviewed, so it needs reviewing again';
  if (!reason) return { status: 'pass', severity: 'none', action: 'continue' };
  const severity = severityFor(record);
  return { status: 'fail', reason, severity, action: actionFor(severity, record) };
}

function fail(message, code = 2) {
  console.error(`ourkit: ${message}`);
  return code;
}

function main(args) {
  const [action, first, second] = args;
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) return fail(`no Active Change: ${change.error}`, 1);
  const record = readChange(projectDir, change.id);
  const review = record.review || { findings: [] };
  const scope = gateScope(projectDir, change);

  if (action === 'packet') {
    console.log(packet(projectDir, change, record, scope));
    return 0;
  }
  if (action === 'list') {
    console.log(JSON.stringify(review.findings, null, 2));
    return 0;
  }
  if (action === 'add' && SEVERITIES.includes(first) && second && second.trim()) {
    const id = review.findings.reduce((max, finding) => Math.max(max, finding.id), 0) + 1;
    const findings = [...review.findings, { id, severity: first, text: second.trim(), resolved: false }];
    updateChange(projectDir, change.id, { review: { ...review, findings } });
    console.log(`ourkit: recorded finding ${id}`);
    return 0;
  }
  if (action === 'resolve' && first) {
    if (!review.findings.some((finding) => String(finding.id) === first)) return fail(`no finding ${first}`, 1);
    const findings = review.findings.map((finding) => (String(finding.id) === first ? { ...finding, resolved: true } : finding));
    updateChange(projectDir, change.id, { review: { ...review, findings } });
    console.log(`ourkit: resolved finding ${first}`);
    return 0;
  }
  // ADR 0009: a blocking finding gets at most two automatic fixes.
  if (action === 'attempt' && first) {
    const target = review.findings.find((finding) => String(finding.id) === first);
    if (!target) return fail(`no finding ${first}`, 1);
    const attempts = (target.attempts || 0) + 1;
    if (attempts > MAX_FIX_ATTEMPTS) {
      return fail(`finding ${first} has had ${MAX_FIX_ATTEMPTS} fix attempts, so stop and leave it for the user (ADR 0009)`, 1);
    }
    const findings = review.findings.map((finding) => (finding === target ? { ...finding, attempts } : finding));
    updateChange(projectDir, change.id, { review: { ...review, findings } });
    console.log(`ourkit: fix attempt ${attempts} of ${MAX_FIX_ATTEMPTS} for finding ${first}`);
    return 0;
  }
  if (action === 'complete') {
    updateChange(projectDir, change.id, { review: { ...review, reviewed: fingerprint(projectDir, scope) } });
    console.log('ourkit: recorded a review of the change as it now stands');
    return 0;
  }
  return fail('usage: ourkit review <packet | list | add <blocking|non-blocking> "<finding>" | attempt <id> | resolve <id> | complete>');
}

module.exports = { fingerprint, main, reviewGate };
