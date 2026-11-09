// Hands-off intake: an unattended agent only takes tickets from people the team trusts (ADR 0012).
const fs = require('fs');
const { activeChange } = require('./active-change');
const { readChange, updateChange } = require('./change-state');
const { assess } = require('./ticket-standard');

const FACTS = ['authorIsTeam', 'readyLabelPresent', 'readyLabelAppliedByTeam', 'editedByOutsiderAfterReady'];

// Anything not known for certain counts against the ticket, so a failed lookup can't let one through.
function decideIntake(facts) {
  const reasons = [];
  for (const fact of FACTS) {
    // With no label there's nothing to check, so who applied it is not an unknown.
    if (fact === 'readyLabelAppliedByTeam' && facts.readyLabelPresent === false && facts[fact] === undefined) continue;
    if (typeof facts[fact] !== 'boolean') reasons.push(`couldn't establish "${fact}", so it counts against the ticket`);
  }
  const { authorIsTeam, readyLabelPresent, readyLabelAppliedByTeam, editedByOutsiderAfterReady } = facts;
  const vouched = readyLabelPresent === true && readyLabelAppliedByTeam === true;
  if (authorIsTeam !== true && !vouched) {
    reasons.push('it was not created by a team member, and no team member labelled it ourkit:ready');
  }
  if (authorIsTeam !== true && readyLabelPresent === true && readyLabelAppliedByTeam !== true) {
    reasons.push('the ourkit:ready label was not applied by a team member');
  }
  // Someone could write something harmless, get it labelled, then change it.
  if (editedByOutsiderAfterReady === true) {
    reasons.push('someone outside the team edited it after it was approved, so it needs approving again');
  }
  for (const { criterion, message } of assess({ title: facts.title || '', body: facts.body || '' })) {
    reasons.push(`it doesn't meet the Ticket Standard: [${criterion}] ${message}`);
  }
  return { accepted: reasons.length === 0, reasons };
}

function main(args) {
  const [action, value] = args;
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) {
    console.error(`ourkit: no Active Change: ${change.error}`);
    return 1;
  }
  if (action === 'status') {
    console.log(JSON.stringify(readChange(projectDir, change.id).intake || null, null, 2));
    return 0;
  }
  if (action !== 'assess' || !value) {
    console.error('usage: ourkit intake <status | assess <facts-file>>');
    return 2;
  }
  let facts;
  try {
    facts = JSON.parse(fs.readFileSync(value, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    console.error(`ourkit: can't read the facts: ${error.message}`);
    return 2;
  }
  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    console.error('ourkit: the facts must be a JSON object');
    return 2;
  }
  const decision = decideIntake(facts);
  updateChange(projectDir, change.id, { intake: { ticket: facts.ticket ?? null, accepted: decision.accepted } });
  console.log(JSON.stringify(decision, null, 2));
  return decision.accepted ? 0 : 1;
}

module.exports = { decideIntake, main };
