#!/usr/bin/env node
const [, , subcommand, ...args] = process.argv;

const subcommands = {
  'active-change': () => require('../src/active-change').main(args[0]),
  baseline: () => require('../src/baseline').main(args[0]),
  check: () => require('../src/contract-check').main(args[0], args[1]),
  command: () => require('../src/stack-profile').main(args[0], args[1]),
  review: () => require('../src/review').main(args),
  rules: () => require('../src/rules').main(args[0]),
  pending: () => require('../src/connectors').main(args),
  pack: () => require('../src/stack-pack').main(args[0], args[1], args[2]),
  flow: () => require('../src/mode').flowMain(args),
  gate: () => require('../src/gate').main(args),
  decision: () => require('../src/mode').decisionMain(args),
  handsoff: () => require('../src/handsoff').main(args),
  intake: () => require('../src/intake').main(args),
  lessons: () => require('../src/lessons').main(args),
  log: () => require('../src/report').main(args),
  loop: () => require('../src/loop').main(args),
  mockup: () => require('../src/mockup').main(args, 'mockup'),
  prototype: () => require('../src/mockup').main(args, 'prototype'),
  mode: () => require('../src/mode').modeMain(args),
  qa: () => require('../src/qa').main(args),
  question: () => require('../src/mode').questionMain(args),
  task: () => require('../src/tasks').main(args),
  status: () => require('../src/status').main(args),
  statusline: () => require('../src/status').statusLineMain(args),
  sync: () => require('../src/sync').main(args),
  teachback: () => require('../src/teachback').main(args),
  tier: () => require('../src/tier').main(args),
  ticket: () => require('../src/ticket-standard').main(args),
  tracker: () => require('../src/tracker').main(args),
  upgrade: () => require('../src/upgrade').main(args),
};

async function run() {
  if (['--help', '-h', 'help'].includes(subcommand)) {
    console.log(`usage: ourkit [project-dir] to install, or ourkit <subcommand>:
  ${Object.keys(subcommands).sort().join(', ')}`);
    return 0;
  }
  if (Object.hasOwn(subcommands, subcommand)) return subcommands[subcommand]();
  return require('../src/install').main(process.argv.slice(2));
}

run().then((code) => {
  process.exitCode = code;
});
