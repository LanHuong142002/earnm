// Active Change: what the user is working on, inferred so that commands need no arguments.
const { spawnSync } = require('child_process');
const path = require('path');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const KIT_FOLDERS = ['.ourkit', '.claude'];

function git(projectDir, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: projectDir, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function defaultBranch(projectDir) {
  const remote = git(projectDir, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (remote) return remote.replace(/^origin\//, '');
  return ['main', 'master'].find((name) => git(projectDir, ['rev-parse', '--verify', '--quiet', name]) !== null) || null;
}

function changedFiles(projectDir, base) {
  const tracked = git(projectDir, ['diff', '--name-only', base]) || '';
  const untracked = git(projectDir, ['ls-files', '--others', '--exclude-standard']) || '';
  const isKitFile = (file) => KIT_FOLDERS.some((folder) => file === folder || file.startsWith(`${folder}/`));
  const files = `${tracked}\n${untracked}`.split('\n').filter(Boolean).filter((file) => !isKitFile(file));
  return [...new Set(files)].sort();
}

function activeChange(projectDir) {
  if (git(projectDir, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
    return { error: 'this project is not a git repository, so there is no way to tell what is changing' };
  }
  const head = git(projectDir, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const branch = git(projectDir, ['branch', '--show-current']) || null;
  const main = defaultBranch(projectDir);

  if (head && branch && main && branch !== main) {
    const base = git(projectDir, ['merge-base', 'HEAD', main]);
    if (base) return { kind: 'branch', id: branch, branch, base, files: changedFiles(projectDir, base) };
  }
  // No branch of its own: the uncommitted work plus the latest commit.
  const parent = head ? git(projectDir, ['rev-parse', '--verify', '--quiet', 'HEAD~1']) : null;
  const base = parent || EMPTY_TREE;
  const files = changedFiles(projectDir, base);
  if (files.length === 0) return { error: 'nothing has changed yet' };
  return { kind: 'worktree', id: `worktree-${(head || 'initial').slice(0, 12)}`, branch, base, files };
}

function main(projectArg) {
  const result = activeChange(path.resolve(projectArg || process.cwd()));
  if (result.error) {
    console.error(`ourkit: no Active Change: ${result.error}`);
    return 1;
  }
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

module.exports = { activeChange, main };
