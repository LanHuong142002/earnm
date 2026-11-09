// Teach-back: questions the user got wrong are recorded in the Change Report.
const fs = require('fs');
const path = require('path');
const { activeChange } = require('./active-change');
const { relativePathFor } = require('./artifacts');
const { readChange } = require('./change-state');
const { reportRequired } = require('./report');

const SECTION = '## Teach-back';

function recordMiss(projectDir, id, question, misunderstanding) {
  const file = path.join(projectDir, relativePathFor('report', id));
  const line = `- ${question.replace(/\s+/g, ' ').trim()} Misunderstood: ${misunderstanding.replace(/\s+/g, ' ').trim()}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trimEnd() : '';
  if (!existing.includes(SECTION)) {
    fs.writeFileSync(file, `${existing}${existing ? '\n\n' : ''}${SECTION}\n\n${line}\n`);
    return;
  }
  // Add to the end of the section, which may not be the end of the report.
  const start = existing.indexOf(SECTION);
  const next = existing.indexOf('\n## ', start + SECTION.length);
  const end = next === -1 ? existing.length : next;
  const updated = `${existing.slice(0, end).trimEnd()}\n${line}\n${existing.slice(end)}`;
  fs.writeFileSync(file, `${updated.trimEnd()}\n`);
}

function main(args) {
  const [action, question, misunderstanding] = args;
  if (action !== 'miss' || !question || !question.trim() || !misunderstanding || !misunderstanding.trim()) {
    console.error('usage: ourkit teachback miss "<question>" "<what was misunderstood>"');
    return 2;
  }
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) {
    console.error(`ourkit: no Active Change: ${change.error}`);
    return 1;
  }
  if (!reportRequired(readChange(projectDir, change.id))) {
    console.log('ourkit: this change has no Change Report, so nothing was recorded');
    return 0;
  }
  recordMiss(projectDir, change.id, question, misunderstanding);
  console.log('ourkit: recorded in the Change Report');
  return 0;
}

module.exports = { main, recordMiss };
