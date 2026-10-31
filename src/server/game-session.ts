import { randomUUID } from 'node:crypto';
import type { Scene } from '../game/scene.js';
import { encodeTerminal } from '../game/terminal.js';
import { ScriptRunner, TriggerType, type ScriptLibrary } from '../game/rpgscript/index.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../renderer/ui/layout-standard-scene.js';
import { CellBuffer } from '../game/cell-buffer.js';
import {
  portraitFrameAt,
  portraitNextFrameDelay,
  type PortraitAssets,
} from '../game/portrait-assets.js';

const MAX_AXIS = 1000;

export type GameSession = {
  id: string;
  cols: number;
  rows: number;
  open: () => void;
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

export function createGameSession(
  scene: Scene,
  send: (text: string, cols: number, rows: number) => void,
  scripts?: ScriptLibrary,
  portraits?: PortraitAssets,
): GameSession {
  let opened = false;
  let portraitName: string | undefined;
  let portraitStart = 0;
  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  const runner = scripts && new ScriptRunner(scripts);
  const pendingLoadTriggers = [...scene.triggers];
  const layout = new LayoutStandardScene(scene);
  const session: GameSession = {
    id: randomUUID(),
    cols: 80,
    rows: 24,
    open() {
      opened = true;
      dispatchLoadTriggers();
      paint();
    },
    input(data: string) {
      if (!opened || !data) return;
      if (data === '\t' || data === '\x1b[Z') {
        layout.tabs.selectNext(data === '\t' ? 1 : -1);
        paint();
        return;
      }
      if (data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[5~' || data === '\x1b[6~') {
        const pane = runner?.dialogue
          ? layout.dialoguePanel
          : layout.tabs.content(layout.tabs.selectedId);
        const page = pane.innerHeight;
        pane.scrollY +=
          data === '\x1b[A' ? -1 : data === '\x1b[B' ? 1 : data === '\x1b[5~' ? -page : page;
        paint();
        return;
      }
      if (!runner || data.startsWith('\x1b')) return;
      if (runner.choice) {
        const selected = /^[1-9]$/.exec(data)?.[0];
        if (!selected || Number(selected) > runner.choice.options.length) return;
        runner.choose(Number(selected) - 1);
      } else if (runner.dialogue) {
        runner.advance();
      } else return;
      dispatchLoadTriggers();
      paint();
    },
    resize(cols, rows) {
      if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
      session.cols = Math.min(cols, MAX_AXIS);
      session.rows = Math.min(rows, MAX_AXIS);
      if (opened) paint();
    },
    close() {
      opened = false;
      if (animationTimer) clearTimeout(animationTimer);
      animationTimer = undefined;
    },
  };

  function dispatchLoadTriggers(): void {
    while (runner?.isIdle() && pendingLoadTriggers.length) {
      const name = pendingLoadTriggers.shift();
      if (name) runner.dispatchTrigger(name, TriggerType.LOAD);
    }
  }

  function paint(): void {
    if (!opened) return;
    const buffer = new CellBuffer(session.cols, session.rows, STANDARD_BACKGROUND);
    layout.message.text = runner?.dialogue
      ? `${runner.dialogue.actor}: ${runner.dialogue.text}  [Space/Enter]`
      : '';
    layout.choiceMessage.text =
      runner?.choice?.options.map((option, index) => `${index + 1}. ${option}`).join('  ') ?? '';
    const storedName = runner?.dialogue ? runner.getStorage('dialogue.portraitLeft') : undefined;
    const name = typeof storedName === 'string' && storedName ? storedName : undefined;
    if (name !== portraitName) {
      portraitName = name;
      portraitStart = Date.now();
    }
    const portrait = name ? portraits?.get(name) : undefined;
    const elapsed = Date.now() - portraitStart;
    layout.dialoguePanel.setPortrait(
      portrait,
      portrait ? portraitFrameAt(portrait, elapsed) : undefined,
    );
    if (animationTimer) clearTimeout(animationTimer);
    const nextFrame =
      portrait && runner?.dialogue ? portraitNextFrameDelay(portrait, elapsed) : undefined;
    animationTimer = nextFrame === undefined ? undefined : setTimeout(paint, nextFrame);
    layout.render(buffer);
    send(encodeTerminal(buffer), session.cols, session.rows);
  }

  return session;
}
