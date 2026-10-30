import { emitKeypressEvents } from 'node:readline';
import { encodeTerminal, plainText } from '../../game/terminal.js';
import { renderVisualTest, visualTests } from './visual-tests.js';

const args = process.argv.slice(2);
if (args.includes('--list')) {
  process.stdout.write(
    `Available UI tests:\n${visualTests.map((test) => `  ${test.name}`).join('\n')}\n`,
  );
} else {
  const name = args.find((arg) => !arg.startsWith('--')) ?? visualTests[0].name;
  const test = visualTests.find((candidate) => candidate.name === name);
  if (!test || args.some((arg) => arg !== name && arg !== '--plain')) {
    process.stderr.write(
      `Unknown UI test or option. Available: ${visualTests.map((t) => t.name).join(', ')}\n`,
    );
    process.exitCode = 1;
  } else if (args.includes('--plain') || !process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`${plainText(renderVisualTest(test, 80, 24))}\n`);
  } else {
    const selected = test;
    const stdin = process.stdin;
    const stdout = process.stdout;
    let scrollY = 0;
    let stopped = false;

    function draw(): void {
      const cols = Math.max(1, stdout.columns || 80);
      const rows = Math.max(1, stdout.rows || 24);
      scrollY = Math.min(scrollY, Math.max(0, selected.contentHeight - Math.max(0, rows - 1)));
      stdout.write(encodeTerminal(renderVisualTest(selected, cols, rows, scrollY)));
    }

    function cleanup(): void {
      if (stopped) return;
      stopped = true;
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\x1b[0m\x1b[?25h\x1b[?7h\x1b[?1049l');
    }

    function stop(code: number): void {
      cleanup();
      process.exit(code);
    }

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write('\x1b[?1049h\x1b[?25l');
    process.once('exit', cleanup);
    process.once('SIGINT', () => stop(130));
    process.once('SIGTERM', () => stop(143));
    stdout.on('resize', draw);
    stdin.on('keypress', (_text, key) => {
      if (key?.ctrl && key.name === 'c') return stop(0);
      if (key?.name === 'q') return stop(0);
      if (key?.name === 'down' || key?.name === 'j') scrollY++;
      if (key?.name === 'up' || key?.name === 'k') scrollY--;
      scrollY = Math.max(0, scrollY);
      draw();
    });
    draw();
  }
}
