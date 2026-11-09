// Stack Profile: a project's declared technology and commands (ADR 0002).
const fs = require('fs');
const path = require('path');

const PROFILE_PATH = path.join('.ourkit', 'stack-profile.json');
// `deploy` and `smoke` are used by the Deploy Stage (ADR 0010).
const COMMAND_NAMES = ['test', 'lint', 'build', 'run', 'deploy', 'smoke'];

class InvalidStackProfile extends Error {}

function validate(profile) {
  const problems = [];
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    return ['must be a JSON object'];
  }
  const { technologies, commands } = profile;
  if (
    !Array.isArray(technologies) ||
    technologies.some((t) => typeof t !== 'string' || !t.trim())
  ) {
    problems.push('technologies must be a list of names');
  }
  if (commands === null || typeof commands !== 'object' || Array.isArray(commands)) {
    problems.push('commands must be an object');
    return problems;
  }
  for (const [name, command] of Object.entries(commands)) {
    if (!COMMAND_NAMES.includes(name)) {
      problems.push(`unknown command "${name}"; expected one of ${COMMAND_NAMES.join(', ')}`);
    } else if (command !== null && (typeof command !== 'string' || !command.trim())) {
      problems.push(`command "${name}" must be a non-empty string, or null when the project has none`);
    }
  }
  return problems;
}

// Returns null when the project has no Stack Profile yet.
function loadStackProfile(projectDir) {
  const file = path.join(projectDir, PROFILE_PATH);
  if (!fs.existsSync(file)) return null;
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    throw new InvalidStackProfile(`${PROFILE_PATH} must be valid JSON: ${error.message}`);
  }
  const problems = validate(profile);
  if (problems.length > 0) {
    throw new InvalidStackProfile(`${PROFILE_PATH}: ${problems.join('; ')}`);
  }
  return profile;
}

// A missing command is a normal result, not an error: callers must not guess one.
function lookupCommand(projectDir, name) {
  if (!COMMAND_NAMES.includes(name)) {
    throw new InvalidStackProfile(`unknown command "${name}"; expected one of ${COMMAND_NAMES.join(', ')}`);
  }
  const profile = loadStackProfile(projectDir);
  if (profile === null) return { found: false, reason: 'no-profile' };
  const command = profile.commands[name];
  if (command === undefined) return { found: false, reason: 'not-declared' };
  if (command === null) return { found: false, reason: 'none' };
  return { found: true, command };
}

const MISSING_MESSAGES = {
  'no-profile': `the project has no ${PROFILE_PATH.replace(/\\/g, '/')} yet`,
  'not-declared': 'the Stack Profile does not declare it yet',
  none: 'the Stack Profile says the project has none',
};

// Exit codes: 0 found, 1 missing, 2 invalid.
function main(name, projectArg) {
  if (!name) {
    console.error(`usage: ourkit command <${COMMAND_NAMES.join('|')}> [project-dir]`);
    return 2;
  }
  try {
    const result = lookupCommand(path.resolve(projectArg || process.cwd()), name);
    if (result.found) {
      console.log(result.command);
      return 0;
    }
    console.error(`ourkit: no "${name}" command: ${MISSING_MESSAGES[result.reason]}`);
    return 1;
  } catch (error) {
    if (!(error instanceof InvalidStackProfile)) throw error;
    console.error(`ourkit: ${error.message}`);
    return 2;
  }
}

module.exports = { COMMAND_NAMES, InvalidStackProfile, PROFILE_PATH, loadStackProfile, lookupCommand, main };
