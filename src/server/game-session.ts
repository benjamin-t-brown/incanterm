import { randomUUID } from 'node:crypto';
import { getCharacterScriptNames } from '../editor/schema.js';
import { Scene } from '../game/scene.js';
import { Character } from '../game/character.js';
import { findCharacter } from '../game/character-movement.js';
import { PlayerControl } from '../game/player-control.js';
import { commands, type GameScriptContext } from '../game/scene-commands.js';
import { encodeTerminal, encodeTerminalDiff } from '../game/terminal.js';
import { ScriptRunner, TriggerType, type ScriptLibrary } from '../game/rpgscript/index.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../renderer/ui/layout-standard-scene.js';
import { CellBuffer } from '../game/cell-buffer.js';
import { getDialogueActorName, getDialoguePortrait, getPortraitFrameAt, type PortraitAssets } from '../game/portrait-assets.js';

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
  onError?: (error: unknown) => void,
  loadSceneById?: (sceneId: string) => Promise<Scene>,
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
    scene.markers,
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
  const gameContext: GameScriptContext = {
    scene,
    playerControl: control,
    changeScene,
    bark: (character, text, ms) => layout.addBark(character, text, ms),
  };
  const runner =
    scripts &&
    new ScriptRunner(scripts, {
      commands,
      context: gameContext,
      getCharacterId: (reference) => findCharacter(scene, reference, control.playerWalkCh).id,
      isCharacterBusy: (ownerId) => findCharacter(scene, ownerId, control.playerWalkCh).isBusy(),
      writeLog: (message) => layout.appendLog(message),
      onCommandError: (error, location) => {
        layout.appendLog(`[RPGSCRIPT ERROR] ${location}: ${getSafeErrorMessage(error)}`, true);
      },
    });
  function attachStepTriggers(): void {
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
  }
  attachStepTriggers();
  let pendingLoadTriggers = [...scene.triggers];

  async function changeScene(sceneId: string, markerName: string | undefined, location: string): Promise<void> {
    if (!loadSceneById) throw new Error(`${location}: changeScene requires a scene loader`);
    const controlled = control.playerWalkCh;
    if (!controlled) throw new Error(`${location}: changeScene requires a player-controlled walker`);
    const loaded = await loadSceneById(sceneId);
    if (!opened) return;
    const marker = loaded.getMarker(markerName ?? 'mPlayer');
    if (!marker)
      layout.appendLog(`[RPGSCRIPT ERROR] ${location}: Scene ${sceneId} has no marker ${markerName ?? 'mPlayer'}; placing player at 0,0`, true);
    control.stop();
    runner?.clearSubscripts();
    const player = controlled.clone();
    player.stopWalking();
    player.x = marker?.x ?? 0;
    player.y = (marker?.y ?? 0) - player.bottomOffset;
    scene = new Scene(loaded.id, loaded.width, loaded.height, loaded.depthMode, loaded.clear,
      [...loaded.entities.filter((entity) => entity.id !== player.id).map((entity) =>
        entity instanceof Character ? entity.clone() : entity), player],
      loaded.triggers, loaded.blockedCells, loaded.actionTriggers, loaded.stepTriggers, loaded.markers);
    control.changeScene(scene, player);
    gameContext.scene = scene;
    layout.scene = scene;
    layout.clearBarks();
    pendingLoadTriggers = [...scene.triggers];
    runner?.restartTimers(scene.triggers);
    previousFrame = undefined;
    attachStepTriggers();
  }
  const session: GameSession = {
    id: randomUUID(),
    cols: 80,
    rows: 24,
    open() {
      opened = true;
      previousFrame = undefined;
      lastUpdate = Date.now();
      runner?.restartTimers(scene.triggers);
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
            if (runner?.centerToast !== undefined) {
              runner.dismissCenterToast();
              finishConversationIfIdle();
              dispatchLoadTriggers();
            } else if (runner?.dialogue) {
              runner.advance();
              finishConversationIfIdle();
              dispatchLoadTriggers();
            } else if (runner?.isIdle() && runner.getStorage('dialogue.active') !== true) {
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
                      finishConversationIfIdle();
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
        if (runner?.centerToast !== undefined) return;
        layout.tabs.selectNext(data === '\t' ? 1 : -1);
        paint();
        return;
      }
      if (data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[5~' || data === '\x1b[6~') {
        if (runner?.centerToast !== undefined) return;
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
      if (runner.centerToast !== undefined) {
        if (data !== ' ' && data !== '\r' && data !== '\n') return;
        runner.dismissCenterToast();
      } else if (runner.choice) {
        const selected = /^[1-9]$/.exec(data)?.[0];
        if (!selected || Number(selected) > runner.choice.options.length) return;
        runner.choose(Number(selected) - 1);
      } else if (runner.dialogue) {
        runner.advance();
      } else return;
      finishConversationIfIdle();
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
      runner?.clearSubscripts();
      if (animationTimer) clearTimeout(animationTimer);
      animationTimer = undefined;
      control.stop();
      ++portraitRefresh;
      control.endConversation(false);
      mouseInput = '';
    },
  };

  function dispatchLoadTriggers(): void {
    while (runner?.isIdle() && pendingLoadTriggers.length) {
      const name = pendingLoadTriggers.shift();
      if (name) runner.dispatchTrigger(name, TriggerType.LOAD);
    }
  }

  function finishConversationIfIdle(): void {
    if (runner?.isIdle()) control.endConversation(true);
  }

  function updateSimulation(): void {
    if (!opened) return;
    try {
      const now = Date.now();
      scene.update(now - lastUpdate);
      layout.updateBarks(now - lastUpdate);
      control.update();
      runner?.update();
      finishConversationIfIdle();
      dispatchLoadTriggers();
      runner?.updateTimers(now - lastUpdate);
      lastUpdate = now;
      paint();
      animationTimer = setTimeout(updateSimulation, FRAME_INTERVAL_MS);
    } catch (error) {
      session.close();
      if (onError) onError(error);
      else throw error;
    }
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
        layout.appendLog(`Could not reload portraits: ${getSafeErrorMessage(error)}`, true);
    });
  }

  function paint(force = false): void {
    needsFrame ||= force;
    if (!opened) return;
    layout.conversationOpen = runner?.getStorage('dialogue.active') === true;
    layout.centerToast.visible = runner?.centerToast !== undefined;
    if (runner?.centerToast !== undefined)
      layout.centerToast.setMessage(runner.centerToast, session.cols, session.rows);
    const leftActor = runner?.getStorage('dialogue.leftActor');
    const rightActor = runner?.getStorage('dialogue.rightActor');
    const paired = layout.conversationOpen && typeof leftActor === 'string' && typeof rightActor === 'string';
    const dialogue = runner?.dialogue;
    const displayedActor = dialogue && getDisplayedActorName(dialogue.actor);
    const displayedLeft = typeof leftActor === 'string' ? getDisplayedActorName(leftActor) : undefined;
    const displayedRight = typeof rightActor === 'string' ? getDisplayedActorName(rightActor) : undefined;
    layout.dialoguePanel.advanceHint.visible = runner?.dialogue !== undefined;
    if (paired && displayedLeft && displayedRight)
      layout.dialoguePanel.setSpeakers(displayedLeft, displayedRight, displayedActor);
    else layout.dialoguePanel.setSpeaker(displayedActor);
    layout.message.text = runner?.dialogue
      ? runner.dialogue.text
      : '';
    layout.choiceMessage.text =
      runner?.choice?.options.map((option, index) => `${index + 1}. ${option}`).join('  ') ?? '';
    const selection = paired
      ? getDialoguePortrait(activePortraits, leftActor, displayedActor === displayedLeft ? dialogue?.emotion : '', 'right')
      : dialogue && layout.conversationOpen
      ? getDialoguePortrait(activePortraits, dialogue.actor, dialogue.emotion, 'right')
      : undefined;
    const rightSelection = paired
      ? getDialoguePortrait(activePortraits, rightActor, displayedActor === displayedRight ? dialogue?.emotion : '', 'left')
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

  function getDisplayedActorName(actor: string): string {
    const character = scene.entities.find((entity) =>
      entity instanceof Character && getCharacterScriptNames(entity.scriptName).includes(actor));
    return getCharacterScriptNames(character instanceof Character ? character.scriptName : undefined)[0]
      ?? getDialogueActorName(activePortraits, actor);
  }

  return session;
}

function getSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return [...message].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
  }).join('');
}
