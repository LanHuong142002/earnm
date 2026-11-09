// An arrow-key menu for the Installer's questions in a terminal. Piped input uses typed answers instead.
const readline = require('readline');

const CLEAR_LINE = '\x1b[2K';
const up = (lines) => `\x1b[${lines}A`;
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const highlight = (text) => `\x1b[36m${text}\x1b[0m`;

// Resolves to the chosen index, or null when the user cancels with Ctrl+C or Escape.
function select(question, labels, initial = 0, { input = process.stdin, output = process.stdout } = {}) {
  return new Promise((resolve) => {
    let index = initial;
    const render = () => {
      for (const [i, label] of labels.entries()) {
        output.write(`${CLEAR_LINE}${i === index ? highlight(`> ${label}`) : `  ${label}`}\n`);
      }
    };
    const finish = (value) => {
      input.removeListener('keypress', onKey);
      if (input.isTTY) input.setRawMode(false);
      input.pause();
      // Replaces the menu with the answer, so the terminal keeps a short record.
      output.write(up(labels.length + 1));
      for (let i = 0; i <= labels.length; i += 1) output.write(`${CLEAR_LINE}\n`);
      output.write(up(labels.length + 1));
      output.write(`${question} ${value === null ? dim('cancelled') : highlight(labels[value])}\n`);
      resolve(value);
    };
    function onKey(_, key = {}) {
      if (key.name === 'up' || key.name === 'k') index = (index - 1 + labels.length) % labels.length;
      else if (key.name === 'down' || key.name === 'j') index = (index + 1) % labels.length;
      else if (key.name === 'return' || key.name === 'enter') return finish(index);
      else if ((key.ctrl && key.name === 'c') || key.name === 'escape') return finish(null);
      else return undefined;
      output.write(up(labels.length));
      return render();
    }
    output.write(`${question} ${dim('(arrows to move, Enter to choose)')}\n`);
    render();
    readline.emitKeypressEvents(input);
    if (input.isTTY) input.setRawMode(true);
    input.on('keypress', onKey);
    input.resume();
  });
}

module.exports = { select };
