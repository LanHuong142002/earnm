// Mode, Decision Log and Question Batch for the Active Change (ADR 0012).
const { activeChange } = require('./active-change');
const { readChange, updateChange } = require('./change-state');

const MODES = ['pair', 'hands-off'];
const DEFAULT_MODE = 'pair';

const modeOf = (record) => record.mode || DEFAULT_MODE;
const nextId = (items) => items.reduce((max, item) => Math.max(max, item.id), 0) + 1;

function fail(message, code = 2) {
  console.error(`ourkit: ${message}`);
  return code;
}

function withChange(run) {
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) return fail(`no Active Change: ${change.error}`, 1);
  return run(projectDir, change.id, readChange(projectDir, change.id));
}

function modeMain(args) {
  return withChange((projectDir, id, record) => {
    const [value] = args;
    if (value === undefined) {
      console.log(modeOf(record));
      return 0;
    }
    if (!MODES.includes(value)) return fail(`Mode must be ${MODES.join(' or ')}`);
    updateChange(projectDir, id, { mode: value });
    console.log(`ourkit: Mode is ${value}`);
    return 0;
  });
}

function flowMain(args) {
  return withChange((projectDir, id, record) => {
    const [value] = args;
    if (value === undefined) {
      console.log(record.flow || 'standard');
      return 0;
    }
    if (value !== 'bug-fix') return fail('usage: ourkit flow [bug-fix]');
    updateChange(projectDir, id, { flow: value });
    console.log('ourkit: this change follows the Bug-fix flow');
    return 0;
  });
}

function decisionMain(args) {
  return withChange((projectDir, id, record) => {
    const decisions = record.decisions || [];
    const [action, text, flag, why] = args;
    if (action === 'list') {
      console.log(JSON.stringify(decisions, null, 2));
      return 0;
    }
    if (action === 'add' && text && text.trim() && flag === '--why' && why && why.trim()) {
      const entry = { id: nextId(decisions), decision: text.trim(), why: why.trim() };
      updateChange(projectDir, id, { decisions: [...decisions, entry] });
      console.log(`ourkit: logged decision ${entry.id}`);
      return 0;
    }
    return fail('usage: ourkit decision <list | add "<decision>" --why "<one sentence>">');
  });
}

function questionMain(args) {
  return withChange((projectDir, id, record) => {
    const questions = record.questions || [];
    const [action, first, second] = args;
    if (action === 'list') {
      const open = args.includes('--open');
      console.log(JSON.stringify(open ? questions.filter((q) => q.answer === null) : questions, null, 2));
      return 0;
    }
    if (action === 'add' && first && first.trim()) {
      const entry = { id: nextId(questions), question: first.trim(), answer: null };
      updateChange(projectDir, id, { questions: [...questions, entry] });
      console.log(`ourkit: added question ${entry.id} to the Question Batch`);
      return 0;
    }
    if (action === 'answer' && first && second && second.trim()) {
      if (!questions.some((q) => String(q.id) === first)) return fail(`no question ${first}`, 1);
      updateChange(projectDir, id, {
        questions: questions.map((q) => (String(q.id) === first ? { ...q, answer: second.trim() } : q)),
      });
      console.log(`ourkit: recorded the answer to question ${first}`);
      return 0;
    }
    return fail('usage: ourkit question <list [--open] | add "<question>" | answer <id> "<answer>">');
  });
}

module.exports = { DEFAULT_MODE, MODES, decisionMain, flowMain, modeMain, modeOf, questionMain };
