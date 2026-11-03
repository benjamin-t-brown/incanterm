import { randomUUID } from 'node:crypto';
import { Scene } from '../game/scene.js';
import { Character } from '../game/character.js';
import { PlayerControl } from '../game/player-control.js';
import { commands } from '../game/scene-commands.js';
import { encodeTerminal, encodeTerminalDiff } from '../game/terminal.js';
import { ScriptRunner, TriggerType, type ScriptLibrary } from '../game/rpgscript/index.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../renderer/ui/layout-standard-scene.js';
import { CellBuffer } from '../game/cell-buffer.js';
import { getDialoguePortrait, getPortraitFrameAt, type PortraitAssets } from '../game/portrait-assets.js';

const MAX_AXIS = 1000;
const FRAME_INTERVAL_MS = Math.ceil(1000 / 30);

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
  canSend: () => boolean = () => true,
  reloadPortraits?: () => Promise<PortraitAssets>,
): GameSession {
  // Each connection owns its character positions, animation clocks and walking path.
  scene = new Scene(
    scene.id,
    scene.width,
    scene.height,
    scene.depthMode,
    scene.clear,
    scene.entities.map((entity) => (entity instanceof Character ? entity.clone() : entity)),
    scene.triggers,
    scene.blockedCells,
    scene.actionTriggers,
    scene.stepTriggers,
  );
  const control = new PlayerControl(scene);
  let lastUpdate = Date.now();
  let mouseInput = '';
  let opened = false;
  let previousFrame: CellBuffer | undefined;
  let needsFrame = false;
  let portraitKey: string | undefined;
  let activePortraits = portraits;
  let portraitRefresh = 0;
  let portraitStart = 0;
  let animationTimer: ReturnType<typeof setTimeout> | undefined;
  const layout = new LayoutStandardScene(scene);
  const runner =
    scripts &&
    new ScriptRunner(scripts, {
      commands,
      context: { scene, playerControl: control },
      writeLog: (message) => layout.appendLog(message),
    });
  for (const entity of scene.entities) {
    if (!(entity instanceof Character)) continue;
    entity.handleStep = (character) => {
      if (control.playerWalkCh !== character) return;
      for (const trigger of scene.stepTriggers) {
        if (
          character.x >= trigger.x &&
          character.bottomY >= trigger.y &&
          character.x < trigger.x + trigger.width &&
          character.bottomY < trigger.y + trigger.height &&
          runner?.dispatchTrigger(trigger.trigger, TriggerType.STEP, trigger.id)
        ) {
          character.stopWalking();
          break;
        }
      }
    };
  }
  const pendingLoadTriggers = [...scene.triggers];
  const session: GameSession = {
    id: randomUUID(),
    cols: 80,
    rows: 24,
    open() {
      opened = true;
      previousFrame = undefined;
      lastUpdate = Date.now();
      dispatchLoadTriggers();
      scene.update(0);
      paint();
      refreshPortraits();
      if (animationTimer) clearTimeout(animationTimer);
      animationTimer = setTimeout(updateSimulation, FRAME_INTERVAL_MS);
    },
    input(data: string) {
      if (!opened || !data) return;
      if (mouseInput || data.startsWith('\x1b[<')) {
        mouseInput += data;
        while (mouseInput) {
          const match = mouseInput.startsWith('\x1b')
            ? /^\[<(\d+);(\d+);(\d+)([Mm])/.exec(mouseInput.slice(1))
            : null;
          if (!match) {
            if (
              !mouseInput.startsWith('\x1b') ||
              !/^\[<[\d;]*$/.test(mouseInput.slice(1)) ||
              mouseInput.length > 64
            )
              mouseInput = '';
            return;
          }
          mouseInput = mouseInput.slice(match[0].length + 1);
          if (Number(match[1]) === 0 && match[4] === 'M') {
            const x = Number(match[2]) - 1;
            const y = Number(match[3]) - 1;
            if (runner?.dialogue) {
              runner.advance();
              dispatchLoadTriggers();
            } else if (runner?.getStorage('dialogue.active') !== true && !runner?.dialogue) {
              const point = layout.getScenePoint(x, y);
              if (point)
                control.click(
                  point.x,
                  point.y,
                  (name, id) => runner?.dispatchTrigger(name, TriggerType.ACTION, id) ?? false,
                  (script, target) => {
                    if (runner?.isIdle() && scripts?.get(script)?.parameters.length === 0) {
                      control.startConversation(target);
                      runner.start(script);
                      refreshPortraits();
                    }
                  },
                );
              else control.cancelTalk();
            }
            paint();
          }
        }
        return;
      }
      if (data === '\t' || data === '\x1b[Z') {
        layout.tabs.selectNext(data === '\t' ? 1 : -1);
        paint();
        return;
      }
      if (data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[5~' || data === '\x1b[6~') {
        const pane = runner?.dialogue
          ? layout.dialoguePanel
          : layout.tabs.getContent(layout.tabs.selectedId);
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
      if (session.cols !== Math.min(cols, MAX_AXIS) || session.rows !== Math.min(rows, MAX_AXIS))
        previousFrame = undefined;
      session.cols = Math.min(cols, MAX_AXIS);
      session.rows = Math.min(rows, MAX_AXIS);
      if (opened) paint(true);
    },
    close() {
      opened = false;
      if (animationTimer) clearTimeout(animationTimer);
      animationTimer = undefined;
      control.stop();
      ++portraitRefresh;
      mouseInput = '';
    },
  };

  function dispatchLoadTriggers(): void {
    while (runner?.isIdle() && pendingLoadTriggers.length) {
      const name = pendingLoadTriggers.shift();
      if (name) runner.dispatchTrigger(name, TriggerType.LOAD);
    }
  }

  function updateSimulation(): void {
    if (!opened) return;
    const now = Date.now();
    scene.update(now - lastUpdate);
    control.update();
    lastUpdate = now;
    paint();
    animationTimer = setTimeout(updateSimulation, FRAME_INTERVAL_MS);
  }

  function refreshPortraits(): void {
    if (!reloadPortraits) return;
    const token = ++portraitRefresh;
    void reloadPortraits().then((updated) => {
      if (!opened || token !== portraitRefresh) return;
      activePortraits = updated;
      portraitKey = undefined;
      paint();
    }).catch((error: unknown) => {
      if (opened && token === portraitRefresh)
        layout.appendLog(`Could not reload portraits: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  function paint(force = false): void {
    needsFrame ||= force;
    if (!opened) return;
    layout.conversationOpen = runner?.getStorage('dialogue.active') === true;
    const leftActor = runner?.getStorage('dialogue.leftActor');
    const rightActor = runner?.getStorage('dialogue.rightActor');
    const paired = layout.conversationOpen && typeof leftActor === 'string' && typeof rightActor === 'string';
    layout.dialoguePanel.advanceHint.visible = runner?.dialogue !== undefined;
    if (paired) layout.dialoguePanel.setSpeakers(leftActor, rightActor, runner?.dialogue?.actor);
    else layout.dialoguePanel.setSpeaker(runner?.dialogue?.actor);
    layout.message.text = runner?.dialogue
      ? runner.dialogue.text
      : '';
    layout.choiceMessage.text =
      runner?.choice?.options.map((option, index) => `${index + 1}. ${option}`).join('  ') ?? '';
    const dialogue = runner?.dialogue;
    const selection = paired
      ? getDialoguePortrait(activePortraits, leftActor, dialogue?.actor === leftActor ? dialogue.emotion : '', 'right')
      : dialogue && layout.conversationOpen
      ? getDialoguePortrait(activePortraits, dialogue.actor, dialogue.emotion, 'right')
      : undefined;
    const rightSelection = paired
      ? getDialoguePortrait(activePortraits, rightActor, dialogue?.actor === rightActor ? dialogue.emotion : '', 'left')
      : undefined;
    const key = `${dialogue?.actor ?? ''}:${dialogue?.emotion ?? ''}:${selection?.facing ?? ''}:${rightSelection?.facing ?? ''}`;
    if (key !== portraitKey) {
      portraitKey = key;
      portraitStart = Date.now();
    }
    if (!canSend()) return;
    const buffer = new CellBuffer(session.cols, session.rows, STANDARD_BACKGROUND);
    const portrait = selection?.asset;
    const elapsed = Date.now() - portraitStart;
    layout.dialoguePanel.setPortrait(
      portrait,
      portrait ? getPortraitFrameAt(portrait, elapsed) : undefined,
    );
    layout.dialoguePanel.setRightPortrait(
      rightSelection?.asset,
      rightSelection ? getPortraitFrameAt(rightSelection.asset, elapsed) : undefined,
    );
    layout.render(buffer);
    const frame = encodeTerminalDiff(buffer, previousFrame);
    if (frame || needsFrame) {
      send(
        frame || encodeTerminal(buffer, { clear: false, fullScreen: true }),
        session.cols,
        session.rows,
      );
      previousFrame = buffer;
      needsFrame = false;
    }
  }

  return session;
}
