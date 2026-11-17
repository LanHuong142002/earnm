// Baseline: the state of a Brownfield project's code when the kit was installed (ADR 0006).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASELINE_PATH = path.join('.ourkit', 'baseline.json');
// The kit's own folders aren't the project's code, and installing them mustn't count as a change.
// .gitattributes holds the block that marks the kit's files as generated (ADR 0015).
const KIT_FOLDERS = ['.ourkit', '.claude', '.gitattributes'];

function git(projectDir, args) {
  const result = spawnSync('git', args, { cwd: projectDir, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function readBaseline(projectDir) {
  const file = path.join(projectDir, BASELINE_PATH);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

function recordBaseline(projectDir) {
  const existing = readBaseline(projectDir);
  if (existing) return { error: `the Baseline is already recorded at ${existing.commit} and must not move` };
  if (git(projectDir, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return { error: 'this project is not a git repository, so a Baseline can\'t be recorded; run git init and commit first' };
  }
  const commit = git(projectDir, ['rev-parse', 'HEAD']);
  if (!commit) return { error: 'this repository has no commits, so a Baseline can\'t be recorded; commit the existing code first' };

  const status = git(projectDir, ['status', '--porcelain', '--', '.', ...KIT_FOLDERS.map((folder) => `:(exclude)${folder}`)]);
  const uncommitted = status ? status.split('\n').length : 0;
  fs.mkdirSync(path.dirname(path.join(projectDir, BASELINE_PATH)), { recursive: true });
  fs.writeFileSync(path.join(projectDir, BASELINE_PATH), `${JSON.stringify({ commit }, null, 2)}\n`);
  return { commit, uncommitted };
}

function main(projectArg) {
  const { error, commit, uncommitted } = recordBaseline(path.resolve(projectArg || process.cwd()));
  if (error) {
    console.error(`ourkit: ${error}`);
    return 1;
  }
  console.log(`ourkit: Baseline recorded at ${commit}`);
  if (uncommitted > 0) console.log(`ourkit: ${uncommitted} uncommitted file(s) will count as changed since the Baseline`);
  return 0;
}

module.exports = { BASELINE_PATH, main, readBaseline, recordBaseline };
