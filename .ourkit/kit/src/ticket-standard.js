// Ticket Standard: the measurable part of the 4C assessment.
// Whether a ticket is Correct, and most of whether it is Clear, needs the agent's judgment.
const fs = require('fs');

const TITLE_MAX = 72;
const WORDS_MAX = 500;
const TICKET_FIELDS = ['Summary', 'User Story', 'Context', 'Scope Boundary', 'Links & References'];
const PR_FIELDS = ['Summary', 'Context', 'Scope Boundary', 'How To Verify', 'Links & References'];
const ALL_FIELDS = [...new Set([...TICKET_FIELDS, ...PR_FIELDS, 'Blocked by'])];
const PLACEHOLDER = /\b(TODO|TBD|FIXME)\b|<[a-z][a-z -]*>|\?\?\?/;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Accepts "**Field:** text" and "## Field". A field runs until the next known field.
function parseFields(body) {
  const names = ALL_FIELDS.map(escapeRegExp).join('|');
  const marker = new RegExp(`^(?:\\*\\*(${names}):\\*\\*|#{1,6}\\s+(${names})\\s*$)`, 'gm');
  const text = body.replace(/\r\n/g, '\n');
  const matches = [...text.matchAll(marker)];
  const fields = {};
  matches.forEach((match, index) => {
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    fields[match[1] || match[2]] = text.slice(match.index + match[0].length, end).trim();
  });
  return fields;
}

function assess({ title = '', body = '', kind = 'ticket' }) {
  const problems = [];
  const add = (criterion, message) => problems.push({ criterion, message });
  const required = kind === 'pr' ? PR_FIELDS : TICKET_FIELDS;
  const fields = parseFields(body);
  const cleanTitle = title.trim();

  if (!cleanTitle) add('Complete', 'Title is missing');
  if (cleanTitle.length > TITLE_MAX) add('Concise', `Title must be at most ${TITLE_MAX} characters`);
  if (cleanTitle.endsWith('.')) add('Clear', 'Title must not end with a period');

  for (const field of required) {
    if (!(field in fields)) add('Complete', `${field} is missing`);
    else if (!fields[field]) add('Complete', `${field} is empty`);
  }

  const story = fields['User Story'];
  if (kind === 'ticket' && story && !/^As an? .+, I want .+, so that .+/is.test(story)) {
    add('Clear', 'User Story must read "As a ..., I want ..., so that ..."');
  }
  const scope = fields['Scope Boundary'];
  if (scope) {
    if (!/^\s*-?\s*In:/im.test(scope)) add('Complete', 'Scope Boundary must say what is In');
    if (!/^\s*-?\s*Out:/im.test(scope)) add('Complete', 'Scope Boundary must say what is Out');
  }
  // Inline code is left out: it can legitimately show a placeholder such as `<project-dir>`.
  const placeholder = body.replace(/```[\s\S]*?```|`[^`]*`/g, '').match(PLACEHOLDER);
  if (placeholder) add('Clear', `Contains the placeholder "${placeholder[0]}"`);

  const words = body.trim().split(/\s+/).filter(Boolean).length;
  if (words > WORDS_MAX) add('Concise', `Body has ${words} words; the limit is ${WORDS_MAX}`);
  return problems;
}

function main(args) {
  const usage = 'usage: ourkit ticket <body-file> --title "<title>" [--pr]';
  const titleIndex = args.indexOf('--title');
  const title = titleIndex >= 0 ? args[titleIndex + 1] : undefined;
  const bodyFile = args.find((arg, index) => !arg.startsWith('--') && index !== titleIndex + 1);
  if (!bodyFile || title === undefined) {
    console.error(usage);
    return 2;
  }
  if (!fs.existsSync(bodyFile)) {
    console.error(`ourkit: no file at ${bodyFile}`);
    return 2;
  }
  const kind = args.includes('--pr') ? 'pr' : 'ticket';
  const problems = assess({ title, body: fs.readFileSync(bodyFile, 'utf8'), kind });
  for (const { criterion, message } of problems) console.error(`[${criterion}] ${message}`);
  if (problems.length > 0) return 1;
  console.log(`ourkit: the ${kind === 'pr' ? 'PR' : 'ticket'} passes the measurable 4C criteria`);
  return 0;
}

module.exports = { assess, main, parseFields };
