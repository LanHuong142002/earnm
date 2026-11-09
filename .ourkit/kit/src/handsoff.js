// Hands-off records: what forces a stop, what the user must do on a service, and the Test Handoff.
const { activeChange } = require('./active-change');
const { readChange, updateChange } = require('./change-state');

// ADR 0012: these changes stop after Plan and before Ship.
function stopRequired(record) {
  return (record.sensitiveAreas || []).length > 0 || (record.serviceActions || []).length > 0;
}

// A ticket linked to this change must have passed intake. A direct request has no ticket.
function intakeProblem(record) {
  if (!record.ticket) return null;
  const { intake } = record;
  if (!intake || String(intake.ticket) !== String(record.ticket)) return `ticket ${record.ticket} has not passed intake yet`;
  return intake.accepted ? null : `ticket ${record.ticket} was rejected at intake`;
}

const fail = (message, code = 2) => {
  console.error(`ourkit: ${message}`);
  return code;
};

function main(args) {
  const [action, first, second] = args;
  const projectDir = process.cwd();
  const change = activeChange(projectDir);
  if (change.error) return fail(`no Active Change: ${change.error}`, 1);
  const record = readChange(projectDir, change.id);

  if (action === 'status') {
    console.log(JSON.stringify({
      mode: record.mode || 'pair',
      stopRequired: stopRequired(record),
      serviceActions: record.serviceActions || [],
      intakeProblem: intakeProblem(record),
      testHandoff: record.testHandoff || [],
    }, null, 2));
    return 0;
  }
  if (action === 'needs-service' && first && first.trim()) {
    updateChange(projectDir, change.id, { serviceActions: [...(record.serviceActions || []), first.trim()] });
    console.log('ourkit: this change will stop after Plan and before Ship');
    return 0;
  }
  if (action === 'test-handoff' && first && first.trim() && second && second.trim()) {
    const entry = { what: first.trim(), steps: second.trim() };
    updateChange(projectDir, change.id, { testHandoff: [...(record.testHandoff || []), entry] });
    console.log('ourkit: added to the Test Handoff');
    return 0;
  }
  return fail('usage: ourkit handsoff <status | needs-service "<what the user must do>" | test-handoff "<what to test>" "<step-by-step instructions>">');
}

module.exports = { intakeProblem, main, stopRequired };
