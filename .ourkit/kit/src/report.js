// Change Report rules and the Project Log.
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { readChange } = require('./change-state');

const LOG_PATH = path.join('.ourkit', 'project-log.md');
const LOG_HEADER = '# Project Log\n\n| Date | Name | Tier | Summary | Link |\n|---|---|---|---|---|\n';

// A Feature or Epic has one, and a Bug-fix only when it touches a Sensitive Area. A Patch never does.
function reportRequired(record) {
  const sensitive = (record.sensitiveAreas || []).length > 0;
  if (record.flow === 'bug-fix') return sensitive;
  return record.tier === 'feature' || record.tier === 'epic';
}

const cell = (text) => text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

function addLogLine(projectDir, { name, tier, summary, link }) {
  const file = path.join(projectDir, LOG_PATH);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : LOG_HEADER;
  const date = new Date().toISOString().slice(0, 10);
  const separator = existing.endsWith('\n') ? '' : '\n';
  const line = `| ${date} | ${cell(name)} | ${cell(tier)} | ${cell(summary)} | ${cell(link)} |\n`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${existing}${separator}${line}`);
}

function main(args) {
  const [action, name, summary, link] = args;
  const projectDir = process.cwd();
  if (action === 'add' && name && name.trim() && summary && summary.trim() && link && link.trim()) {
    const change = activeChange(projectDir);
    if (change.error) {
      console.error(`ourkit: no Active Change: ${change.error}`);
      return 1;
    }
    const record = readChange(projectDir, change.id);
    if (!reportRequired(record)) {
      console.error('ourkit: only a shipped change with a Change Report gets a Project Log line');
      return 1;
    }
    addLogLine(projectDir, { name, tier: record.tier, summary, link });
    console.log('ourkit: added a line to the Project Log');
    return 0;
  }
  console.error('usage: ourkit log add "<name>" "<one-sentence summary>" "<link>"');
  return 2;
}

module.exports = { LOG_PATH, addLogLine, main, reportRequired };
