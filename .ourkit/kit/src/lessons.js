// Lessons: short notes carried between changes, kept small because every Plan reads them.
const fs = require('fs');
const path = require('path');

const LESSONS_PATH = path.join('.ourkit', 'lessons.md');
const MAX_LESSONS = 30;
const KINDS = ['cost', 'quality'];
const HEADER = '# Lessons\n\n';

function readLessons(projectDir) {
  const file = path.join(projectDir, LESSONS_PATH);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line.startsWith('- '));
}

function addLesson(projectDir, kind, text) {
  const line = `- [${kind}] ${text.replace(/\s+/g, ' ').trim()}`;
  // Oldest first, so the oldest lines are the ones dropped.
  const lessons = [...readLessons(projectDir).filter((existing) => existing !== line), line].slice(-MAX_LESSONS);
  const file = path.join(projectDir, LESSONS_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${HEADER}${lessons.join('\n')}\n`);
  return lessons.length;
}

function main(args) {
  const [action, kind, text] = args;
  const projectDir = process.cwd();
  if (action === undefined) {
    const lessons = readLessons(projectDir);
    if (lessons.length > 0) console.log(lessons.join('\n'));
    return 0;
  }
  if (action === 'add' && KINDS.includes(kind) && text && text.trim()) {
    const count = addLesson(projectDir, kind, text);
    console.log(`ourkit: saved the lesson (${count} of ${MAX_LESSONS})`);
    return 0;
  }
  console.error(`usage: ourkit lessons [add <${KINDS.join('|')}> "<lesson>"]`);
  return 2;
}

module.exports = { LESSONS_PATH, MAX_LESSONS, addLesson, main, readLessons };
