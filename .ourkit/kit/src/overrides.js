// Overrides: a project's customized copy of a kit file, which wins over the original (ADR 0007).
const fs = require('fs');
const path = require('path');

const KIT_DIR = path.join('.ourkit', 'kit');
const OVERRIDES_DIR = path.join('.ourkit', 'overrides');

// `kitRelative` is the file's path inside the kit, for example core/a.md.
function resolveKitFile(projectDir, kitRelative) {
  const override = path.join(projectDir, OVERRIDES_DIR, kitRelative);
  if (fs.existsSync(override)) return { file: override, overridden: true };
  return { file: path.join(projectDir, KIT_DIR, kitRelative), overridden: false };
}

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

// An Override with no kit file behind it silently does nothing, for example after
// an upgrade renames the file. Stages, subagents and rules live outside the kit folder, so they're skipped.
const HOST_FOLDERS = ['stages', 'agents', 'rules'];

function orphanOverrides(projectDir) {
  const root = path.join(projectDir, OVERRIDES_DIR);
  return filesUnder(root)
    .map((file) => path.relative(root, file))
    .filter((relative) => !HOST_FOLDERS.some((folder) => relative.startsWith(`${folder}${path.sep}`)))
    .filter((relative) => !fs.existsSync(path.join(projectDir, KIT_DIR, relative)));
}

module.exports = { KIT_DIR, OVERRIDES_DIR, orphanOverrides, resolveKitFile };
