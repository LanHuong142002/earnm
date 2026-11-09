// Connectors: MCP connections, and setup work still waiting for the user.
const fs = require('fs');
const path = require('path');

const CONNECTORS_FILE = '.mcp.json'; // Where Claude Code, the only v1 Host, reads project MCP servers.
const PENDING_PATH = path.join('.ourkit', 'pending.json');
const TOKEN_PATTERN = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|glpat-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)/;
const SECRET_SECTIONS = ['env', 'headers'];

// Reports values, by location only, so a found secret is never printed.
function findSecrets(value, location = [], inSecretSection = false) {
  if (typeof value === 'string') {
    const mustReference = inSecretSection && !value.includes('${');
    return TOKEN_PATTERN.test(value) || mustReference ? [location.join('.')] : [];
  }
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    findSecrets(child, [...location, key], inSecretSection || SECRET_SECTIONS.includes(key)));
}

function checkConnectors(projectDir) {
  const file = path.join(projectDir, CONNECTORS_FILE);
  if (!fs.existsSync(file)) return [];
  const report = (message) => ({ file: CONNECTORS_FILE, contract: 'Connector', message });
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    return [report(`must be valid JSON: ${error.message}`)];
  }
  return findSecrets(config).map((location) =>
    report(`${location} may hold a secret; use a \${VARIABLE} reference and keep the value out of the repo`));
}

function readPending(projectDir) {
  const file = path.join(projectDir, PENDING_PATH);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

function writePending(projectDir, items) {
  const file = path.join(projectDir, PENDING_PATH);
  if (items.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(items, null, 2)}\n`);
}

// `ourkit pending` prints one line, so it's cheap enough to run at the start of every Stage.
function main(args) {
  const [action, value] = args;
  const projectDir = process.cwd();
  const items = readPending(projectDir);
  if (action === undefined) {
    if (items.length > 0) {
      const summary = items.map(({ id, text }) => `${id}. ${text}`).join('; ');
      console.log(`ourkit: ${items.length} setup item(s) waiting: ${summary}`);
    }
    return 0;
  }
  if (action === 'add' && value) {
    const id = items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    writePending(projectDir, [...items, { id, text: value.replace(/\s+/g, ' ').trim() }]);
    console.log(`ourkit: saved setup item ${id}`);
    return 0;
  }
  if (action === 'done' && value) {
    const remaining = items.filter((item) => String(item.id) !== value);
    if (remaining.length === items.length) {
      console.error(`ourkit: no setup item ${value}`);
      return 1;
    }
    writePending(projectDir, remaining);
    console.log(`ourkit: finished setup item ${value}`);
    return 0;
  }
  console.error('usage: ourkit pending [add "<what the user must do>" | done <id>]');
  return 2;
}

module.exports = { CONNECTORS_FILE, checkConnectors, main, readPending };
