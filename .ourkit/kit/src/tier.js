// Tier: decides the Stages a change goes through, with a hard floor for Sensitive Areas (ADR 0004).
const path = require('path');
const { activeChange } = require('./active-change');
const { readChange, updateChange } = require('./change-state');

const TIERS = ['patch', 'feature', 'epic'];
const ROUTES = {
  patch: ['Build', 'Review'],
  feature: ['Spec', 'Plan', 'Tasks', 'Build', 'Review', 'QA', 'Ship'],
  epic: ['Grill', 'Prototype', 'Split into Features'],
};
const AREAS = {
  auth: ['auth', 'authn', 'authz', 'authentication', 'authorization', 'login', 'logout', 'oauth', 'oidc', 'saml', 'sso', 'session', 'sessions', 'permission', 'permissions', 'rbac', 'acl', 'password', 'passwords', 'credential', 'credentials', 'token', 'tokens'],
  data: ['migration', 'migrations', 'backup', 'backups', 'seed', 'seeds'],
  schema: ['schema', 'schemas', 'ddl', 'sql'],
  money: ['payment', 'payments', 'billing', 'invoice', 'invoices', 'checkout', 'refund', 'refunds', 'pricing', 'subscription', 'subscriptions', 'wallet', 'ledger'],
  'public API': ['openapi', 'swagger', 'graphql', 'proto', 'public-api', 'publicapi'],
};

function stagesFor(record) {
  // A Patch in Pair ends at Review because the user commits it. In Hands-off, no one else will, so it ships.
  const handsOff = record.mode === 'hands-off';
  const patchRoute = (stages) => (handsOff ? [...stages, 'Ship'] : stages);
  if (record.flow !== 'bug-fix') {
    return record.tier === 'patch' ? patchRoute(ROUTES.patch) : ROUTES[record.tier];
  }
  const bugFix = ['Reproduce', 'Fix', 'Verify', 'Review'];
  return record.tier === 'patch' ? patchRoute(bugFix) : [...bugFix, 'Ship'];
}

// Splits on separators and camelCase, so "author.txt" isn't "auth" but "AuthService" is.
function tokensOf(file) {
  const spaced = file.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return new Set(spaced.split(/[^a-z0-9]+/).filter(Boolean).concat(spaced.includes('public-api') ? ['public-api'] : []));
}

// A signal from file paths only. It can miss a Sensitive Area, so the agent still has to judge.
function scanSensitive(files) {
  const hits = {};
  for (const file of files) {
    const tokens = tokensOf(file);
    for (const [area, words] of Object.entries(AREAS)) {
      if (words.some((word) => tokens.has(word))) (hits[area] ||= []).push(file);
    }
  }
  return hits;
}

// Returns the reason a Tier is below the floor, or null when it's allowed.
function floorViolation(tier, sensitiveAreas, scanHits, notSensitiveReason) {
  if (tier !== 'patch') return null;
  if (sensitiveAreas.length > 0) return `it touches a Sensitive Area (${sensitiveAreas.join(', ')})`;
  const scanned = Object.keys(scanHits);
  if (scanned.length > 0 && !notSensitiveReason) {
    return `its files look like a Sensitive Area (${scanned.join(', ')}). If that is a false match, say why with --not-sensitive "<reason>"`;
  }
  return null;
}

function parseOptions(args) {
  const options = { positional: [] };
  for (let i = 0; i < args.length; i += 1) {
    if (['--reason', '--sensitive', '--not-sensitive'].includes(args[i])) {
      options[args[i].slice(2)] = args[(i += 1)] ?? '';
    } else options.positional.push(args[i]);
  }
  return options;
}

const parseAreas = (value) => (value || '').split(',').map((area) => area.trim()).filter(Boolean);

function setTier(projectDir, change, { tier, reason, sensitive, notSensitive }) {
  if (!TIERS.includes(tier)) return { error: `Tier must be ${TIERS.join(', ')}`, code: 2 };
  if (!reason || !reason.trim()) return { error: 'a Tier needs a reason; use --reason "<why>"', code: 2 };
  const sensitiveAreas = parseAreas(sensitive);
  if (sensitiveAreas.length > 0 && notSensitive) {
    return { error: 'use either --sensitive or --not-sensitive, not both', code: 2 };
  }
  const violation = floorViolation(tier, sensitiveAreas, scanSensitive(change.files), notSensitive);
  if (violation) return { error: `a Patch isn't allowed, because ${violation} (ADR 0004)`, code: 1 };
  const fields = { tier, tierReason: reason.trim(), sensitiveAreas };
  fields.notSensitiveReason = notSensitive ? notSensitive.trim() : null;
  return { record: updateChange(projectDir, change.id, fields) };
}

function main(args) {
  const [action, ...rest] = args;
  const options = parseOptions(rest);
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) {
    console.error(`ourkit: no Active Change: ${change.error}`);
    return 1;
  }
  if (action === 'scan') {
    console.log(JSON.stringify(scanSensitive(change.files), null, 2));
    return 0;
  }
  if (action === 'set') {
    const { error, code, record } = setTier(projectDir, change, { ...options, tier: options.positional[0], notSensitive: options['not-sensitive'] });
    if (error) {
      console.error(`ourkit: ${error}`);
      return code;
    }
    console.log(`ourkit: Tier is ${record.tier}; Stages: ${ROUTES[record.tier].join(' -> ')}`);
    return 0;
  }
  if (action === 'show') {
    const record = readChange(projectDir, change.id);
    if (!record.tier) {
      console.error('ourkit: this change has no Tier yet');
      return 1;
    }
    console.log(JSON.stringify({ ...record, stages: stagesFor(record) }, null, 2));
    return 0;
  }
  console.error('usage: ourkit tier <scan | show | set <patch|feature|epic> --reason "<why>" [--sensitive <areas>] [--not-sensitive "<why>"]>');
  return 2;
}

module.exports = { ROUTES, TIERS, floorViolation, main, scanSensitive, setTier, stagesFor };
