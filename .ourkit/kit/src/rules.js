// Rule layering: Core, then Roles, then Stack Packs, then Project Rules.
// A Role or Stack Pack is enabled by being installed in the project.
const fs = require('fs');
const path = require('path');
const { KIT_DIR, resolveKitFile } = require('./overrides');

const PROJECT_RULES = path.join('.ourkit', 'rules.md');
const PROJECT_ROLES = path.join('.ourkit', 'roles');

function markdownUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return markdownUnder(full);
      return entry.name.endsWith('.md') ? [full] : [];
    });
}

// Returns files from lowest to highest precedence, with Overrides already applied.
function resolveLayers(projectDir) {
  const kit = path.join(projectDir, KIT_DIR);
  const kitLayer = (name, folder) =>
    markdownUnder(path.join(kit, folder)).map((original) => ({
      layer: name,
      ...resolveKitFile(projectDir, path.relative(kit, original)),
    }));
  const projectLayer = (name, files) => files.map((file) => ({ layer: name, file, overridden: false }));
  const projectRules = path.join(projectDir, PROJECT_RULES);
  return [
    ...kitLayer('Core', 'core'),
    ...kitLayer('Role', 'roles'),
    ...projectLayer('Role', markdownUnder(path.join(projectDir, PROJECT_ROLES))),
    ...kitLayer('Stack Pack', 'stack-packs'),
    ...projectLayer('Project Rules', fs.existsSync(projectRules) ? [projectRules] : []),
  ];
}

function renderRules(projectDir) {
  const sections = resolveLayers(projectDir).map(({ layer, file, overridden }) => {
    const relative = path.relative(projectDir, file).replace(/\\/g, '/');
    const label = overridden ? `${layer} (Override)` : layer;
    return `<!-- ${label}: ${relative} -->\n${fs.readFileSync(file, 'utf8').trim()}`;
  });
  return ['<!-- When rules conflict, the later section wins. -->', ...sections].join('\n\n');
}

function main(projectArg) {
  console.log(renderRules(path.resolve(projectArg || process.cwd())));
  return 0;
}

module.exports = { KIT_DIR, PROJECT_RULES, main, renderRules, resolveLayers };
