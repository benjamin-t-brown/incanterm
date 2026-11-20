import { randomUUID } from 'node:crypto';
import { getCharacterScriptNames } from '../editor/schema.js';
import { Background, Scene, Prop } from '../game/scene.js';
import { Character } from '../game/character.js';
import { AnimatedProp } from '../game/animated-prop.js';
import { canStandAt, findCharacter, getWalkAnchor, isWalkAnchorClear, type Point } from '../game/character-movement.js';
import { PlayerControl } from '../game/player-control.js';
import { PropSlideControl, type PropSlideSettle } from '../game/prop-slide-control.js';
import { applyPropSlidePositions, PropSlideLayouts, type PropSlideState } from '../game/prop-slide-state.js';
import { commands } from '../game/scene-commands.js';
import type { GameScriptContext } from '../game/scene-command-support/context.js';
import { addInventoryItem } from '../game/scene-command-support/inventory.js';
import { getInventoryEntries, getItemCombinationScript, hasInventoryItem, WorldItem, type ItemTarget } from '../game/items.js';
import { compareSceneDrawRank } from '../game/scene-order.js';
import { encodeTerminal, encodeTerminalDiff } from '../game/terminal.js';
import { ScriptRunner, TriggerType, type ScriptLibrary } from '../game/rpgscript/index.js';
import { LayoutStandardScene, STANDARD_BACKGROUND } from '../renderer/ui/layout-standard-scene.js';
import { createGlyphExitFilter, createGlyphGrowthRevealFilter, createTextColorFilter, ScreenFilterPipeline } from '../renderer/screen-filters.js';
import type { Rect } from '../renderer/ui/element.js';
import { CellBuffer } from '../game/cell-buffer.js';
import type { SelectionRect } from '../protocol/messages.js';
import { hasCancelUiAndOpenLogInput, TOGGLE_LOG_WINDOW_INPUT } from '../protocol/input.js';
import { getDialogueActorName, getDialoguePortrait, getPortraitFrameAt, type PortraitAsset, type PortraitAssets, type PortraitFrame } from '../game/portrait-assets.js';

const MAX_AXIS = 1000;
const FRAME_INTERVAL_MS = Math.ceil(1000 / 30);
const INACTIVE_PORTRAIT_FG = { r: 128, g: 128, b: 128 };
const PORTRAIT_REVEAL_SEQUENCE = '.,:+';

export type GameSession = {
  id: string;
  cols: number;
  rows: number;
  open: () => void;
  input: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  /** Abort any prop push flow, restoring a moving prop before returning. */
  cancelPropSlideInteraction: () => boolean;
  /** Detached JSON-ready settled state; excludes live animation and script state. */
  getPropSlideState: () => PropSlideState;
  filters: ScreenFilterPipeline;
  getPortraitScreenRect: (side?: 'left' | 'right') => Rect | undefined;
  getSceneScreenRect: (area?: Readonly<Rect>) => Rect | undefined;
};

export type DialogueAnimationOptions = {
  enabled?: boolean;
  stepDurationMs?: number;
  wordDelayMs?: number;
  growthSequences?: readonly string[];
  shortGrowthSequences?: readonly string[];
};

export type PortraitAnimationOptions = {
  enabled?: boolean;
  stepDurationMs?: number;
  rowDelayMs?: number;
};

function cloneSessionScene(template: Scene, player?: Character): Scene {
  const entities = template.entities.filter((entity) => entity.id !== player?.id)
    .map((entity) => entity instanceof Prop && !(entity instanceof Background) ? entity.clone() : entity);
  if (player) entities.push(player);
  return new Scene(
    template.id, template.width, template.height, template.depthMode, template.clear, entities,
    template.triggers, template.staticBlockedCells, template.actionTriggers, template.stepTriggers,
    template.markers, template.loadCharacter, template.itemAssets, template.propSlide,
  );
}

export function createGameSession(
  scene: Scene,
  send: (text: string, cols: number, rows: number, logSelection?: SelectionRect) => void,
  scripts?: ScriptLibrary,
  portraits?: PortraitAssets,
  canSend: () => boolean = () => true,
  reloadPortraits?: () => Promise<PortraitAssets>,
  onError?: (error: unknown) => void,
  loadSceneById?: (sceneId: string) => Promise<Scene>,
  dialogueAnimation?: DialogueAnimationOptions,
  portraitAnimation?: PortraitAnimationOptions,
  allowPlayerSpawn = false,
  sessionTimerTriggers: readonly string[] = [],
  onPropSlideSettled?: (event: PropSlideSettle) => void,
  initialPropSlideState?: unknown,
): GameSession {
  // Each connection owns its movable entities and their animation and walking state.
  scene = cloneSessionScene(scene);
  const propSlideLayouts = new PropSlideLayouts(initialPropSlideState);
  const initialLayout = propSlideLayouts.restoreRoom(scene);
  let authoredPropPositions = initialLayout.defaults;
  const control = new PlayerControl(scene, allowPlayerSpawn);
  const propSlides = new PropSlideControl(control, (event) => {
    const authored = authoredPropPositions.get(event.instanceId);
    if (event.sceneId === scene.id && authored)
      propSlideLayouts.setSettledAnchor(event.sceneId, event.instanceId, authored, event.to);
    onPropSlideSettled?.(event);
  });
  let propSlideInteraction = false;
  let propPushChoices = false;
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
  if (initialLayout.error) reportPropSlideRestoreError(initialLayout.error);
  const filters = new ScreenFilterPipeline();
  const portraitAnimationEnabled = portraitAnimation?.enabled ?? true;
  const portraitStepDurationMs = portraitAnimation?.stepDurationMs ?? 25;
  const portraitRowDelayMs = portraitAnimation?.rowDelayMs ?? 6.25;
  if (!Number.isFinite(portraitStepDurationMs) || portraitStepDurationMs <= 0)
    throw new Error('Portrait stepDurationMs must be positive');
  if (!Number.isFinite(portraitRowDelayMs) || portraitRowDelayMs < 0)
    throw new Error('Portrait rowDelayMs must be nonnegative');
  let inactiveLeftPortrait = false;
  let inactiveRightPortrait = false;
  const shownPortraitAssets: { left?: PortraitAsset; right?: PortraitAsset } = {};
  const shownPortraitActors: { left?: string; right?: string } = {};
  const portraitReveals: Partial<Record<'left' | 'right', { startedAtMs: number; durationMs: number; remove: () => void }>> = {};
  let portraitExit: {
    startedAtMs: number;
    durationMs: number;
    left?: { asset: PortraitAsset; frame: PortraitFrame };
    right?: { asset: PortraitAsset; frame: PortraitFrame };
    removeFilters: (() => void)[];
  } | undefined;
  const inactivePortraitFilter = createTextColorFilter(INACTIVE_PORTRAIT_FG);
  filters.addFilter(inactivePortraitFilter,
    () => inactiveLeftPortrait ? layout.getPortraitScreenRect('left') : undefined);
  filters.addFilter(inactivePortraitFilter,
    () => inactiveRightPortrait ? layout.getPortraitScreenRect('right') : undefined);
  if (dialogueAnimation?.enabled !== undefined) layout.message.animationEnabled = dialogueAnimation.enabled;
  if (dialogueAnimation?.stepDurationMs !== undefined) {
    if (!Number.isFinite(dialogueAnimation.stepDurationMs) || dialogueAnimation.stepDurationMs <= 0)
      throw new Error('Dialogue stepDurationMs must be positive');
    layout.message.stepDurationMs = dialogueAnimation.stepDurationMs;
  }
  if (dialogueAnimation?.wordDelayMs !== undefined) {
    if (!Number.isFinite(dialogueAnimation.wordDelayMs) || dialogueAnimation.wordDelayMs < 0)
      throw new Error('Dialogue wordDelayMs must be nonnegative');
    layout.message.wordDelayMs = dialogueAnimation.wordDelayMs;
  }
  if (dialogueAnimation?.growthSequences !== undefined) {
    if (!Array.isArray(dialogueAnimation.growthSequences) || !dialogueAnimation.growthSequences.length ||
      dialogueAnimation.growthSequences.some((sequence) => typeof sequence !== 'string' || sequence.length !== 4))
      throw new Error('Dialogue growthSequences must contain four-character strings');
    layout.message.growthSequences = dialogueAnimation.growthSequences;
  }
  if (dialogueAnimation?.shortGrowthSequences !== undefined) {
    if (!Array.isArray(dialogueAnimation.shortGrowthSequences) || !dialogueAnimation.shortGrowthSequences.length ||
      dialogueAnimation.shortGrowthSequences.some((sequence) => typeof sequence !== 'string' || sequence.length !== 4))
      throw new Error('Dialogue shortGrowthSequences must contain four-character strings');
    layout.message.shortGrowthSequences = dialogueAnimation.shortGrowthSequences;
  }
  const gameContext: GameScriptContext = {
    scene,
    playerControl: control,
    changeScene,
    propSlides,
    resetPropSlides: restoreAuthoredPropLayout,
    beginPropSlideInteraction,
    revealPropPushChoices() {
      propPushChoices = true;
    },
    bark: (character, text, ms) => layout.addBark(character, text, ms),
    clearBark: (character) => layout.clearBark(character),
    clearCharacterSubscript: (ownerId) => runner?.clearSubscript(ownerId),
    resetConversationPortraits: () => {
      finishPortraitReveals();
      clearPortraitExit();
    },
  };
  const runner =
    scripts &&
    new ScriptRunner(scripts, {
      commands,
      context: gameContext,
      hasItem: (inventory, reference) => hasInventoryItem(inventory, scene.itemAssets, reference),
      getCharacterId: (reference) => findCharacter(scene, reference, control.playerWalkCh).id,
      isCharacterBusy: (ownerId) => propSlideInteraction && ownerId === control.playerWalkCh?.id ||
        findCharacter(scene, ownerId, control.playerWalkCh).isBusy(),
      writeLog: (message) => layout.appendLog(message),
      onCommandError: (error, location) => {
        layout.appendLog(`[RPGSCRIPT ERROR] ${location}: ${getSafeErrorMessage(error)}`, true);
      },
    });
  let displayedDialogue: NonNullable<typeof runner>['dialogue'];
  let dialogueUpdate = Date.now();
  let selectedItemId: string | undefined;

  function reportPropSlideRestoreError(error: string): void {
    layout.appendLog(`[PROP WARNING] Discarded saved slide layout for ${scene.id}: ${error}`);
  }

  function beginPropSlideInteraction(): void {
    if (propSlideInteraction) return;
    propSlideInteraction = true;
    const player = control.playerWalkCh;
    if (player) runner?.clearSubscript(player.id);
    control.stop();
  }

  function cancelPropSlideInteraction(): boolean {
    const hadOperation = propSlides.cancel();
    if (!propSlideInteraction && !hadOperation) return false;
    propSlideInteraction = false;
    propPushChoices = false;
    runner?.cancel();
    runner?.setStorage('dialogue.active', false);
    runner?.setStorage('dialogue.leftActor', undefined);
    runner?.setStorage('dialogue.rightActor', undefined);
    control.stop();
    control.endConversation(true);
    return true;
  }

  function restoreAuthoredPropLayout(safeMarkerName: string, background: boolean): boolean {
    if (!authoredPropPositions.size) return false;
    const player = control.playerWalkCh;
    let safePosition: Point | undefined;
    if (player && scene.entities.includes(player)) {
      const restoredBlocks = scene.getBlockedCellsAt(authoredPropPositions);
      if (!isWalkAnchorClear(scene, player, player.x, player.bottomY, restoredBlocks)) {
        const marker = scene.getMarker(safeMarkerName);
        if (!marker) throw new Error(`Scene ${scene.id} has no safe reset marker ${safeMarkerName}`);
        safePosition = getWalkAnchor(scene, player, marker);
        if (!canStandAt(scene, player, safePosition, restoredBlocks))
          throw new Error(`Scene ${scene.id} reset marker ${safeMarkerName} is not walkable after reset`);
      }
    }

    // A character subscript can interrupt the push's foreground script; a foreground
    // reset must leave its own script running so it can react to the restored layout.
    if (background) cancelPropSlideInteraction();
    else propSlides.cancel();
    applyPropSlidePositions(scene, authoredPropPositions);
    propSlideLayouts.clearRoom(scene.id);
    if (player && safePosition) {
      control.stopCharacter(player);
      player.x = safePosition.x;
      player.y = safePosition.y - player.bottomOffset;
    }
    return true;
  }

  function activateSlideProp(prop: Prop | undefined): boolean {
    if (!prop?.slidable || !scene.propSlide || !control.playerWalkCh || !runner?.isIdle() ||
      propSlideInteraction || control.isScriptedWalking()) return false;
    const name = prop.slidable.actionScript;
    const definition = scripts?.get(name);
    if (definition?.parameters.length !== 1) {
      layout.appendLog(`[PROP ERROR] ${name} must be an existing one-argument script (prop instance ID: ${prop.id})`, true);
      return true;
    }
    beginPropSlideInteraction();
    runner.start(name, [prop.id]);
    finishConversationIfIdle();
    return true;
  }

  function getNearestVisibleSlideProp(): Prop | undefined {
    const player = control.playerWalkCh;
    const view = layout.getSceneScreenRect();
    if (!player || !view || !scene.propSlide) return;
    const order = scene.getDrawOrder();
    let best: Prop | undefined;
    let bestDistance = Infinity;
    for (const entity of order) {
      if (!(entity instanceof Prop) || !entity.slidable) continue;
      const sprite = entity.getDrawSprite();
      if (!sprite) continue;
      const left = entity.x - sprite.originX;
      const top = entity.y - sprite.originY;
      for (let y = Math.max(0, top); y < Math.min(scene.height, top + sprite.height); y++) {
        for (let x = Math.max(0, left); x < Math.min(scene.width, left + sprite.width); x++) {
          const distance = (player.x - x) ** 2 + (player.bottomY - y) ** 2;
          if (distance >= bestDistance || !layout.getScenePoint(view.x + x, view.y + y) ||
            scene.getVisiblePropAt(x, y, order) !== entity) continue;
          best = entity;
          bestDistance = distance;
        }
      }
    }
    return best;
  }

  function choosePropPushAt(x: number, y: number): void {
    const index = layout.getPushChoiceAt(x, y);
    if (index === undefined) return;
    chooseScriptOption(index);
    finishConversationIfIdle();
    dispatchLoadTriggers();
  }

  function chooseScriptOption(index: number): void {
    propPushChoices = false;
    runner?.choose(index);
  }

  function runItemScript(name: string | undefined): void {
    if (!name || !runner?.isIdle()) return;
    const definition = scripts?.get(name);
    if (definition?.parameters.length !== 0) {
      layout.appendLog(`[ITEM ERROR] ${name} must be an existing zero-argument script`, true);
      return;
    }
    control.stop();
    runner.start(name);
    finishConversationIfIdle();
  }

  function combineSelectedItem(target: ItemTarget): void {
    const source = selectedItemId && scene.itemAssets.get(selectedItemId);
    selectedItemId = undefined;
    if (!source || !runner || !hasInventoryItem(runner.getGlobal('vars.inventory'), scene.itemAssets, source.definition.id)) return;
    const name = getItemCombinationScript(scene.itemAssets, source.definition, target);
    if (name) runItemScript(name);
    else layout.appendLog("Those don't work together.");
  }

  function clickInventoryItem(itemId: string, examine: boolean): void {
    const asset = scene.itemAssets.get(itemId);
    if (!asset || !runner || !hasInventoryItem(runner.getGlobal('vars.inventory'), scene.itemAssets, itemId)) return;
    if (examine) {
      selectedItemId = undefined;
      runItemScript(asset.definition.examineScript);
    } else if (selectedItemId === itemId) selectedItemId = undefined;
    else if (selectedItemId) combineSelectedItem({ targetType: 'item', target: itemId });
    else selectedItemId = itemId;
  }

  function clickWorldItemTarget(x: number, y: number, examine = false): boolean {
    if (!runner) return false;
    const ranked = scene.entities.map((entity, order) => ({ entity, order }));
    ranked.sort((a, b) => compareSceneDrawRank(
      { background: false, foreground: a.entity instanceof Prop && a.entity.foreground, depth: a.entity.getDepth(scene.depthMode), order: a.order },
      { background: false, foreground: b.entity instanceof Prop && b.entity.foreground, depth: b.entity.getDepth(scene.depthMode), order: b.order },
    ));
    const target = ranked.reverse().find(({ entity }) =>
      (entity instanceof WorldItem || selectedItemId && (entity instanceof Character || entity instanceof AnimatedProp && entity.propId)) &&
      entity instanceof Prop &&
      x >= entity.x - entity.sprite.originX && x < entity.x - entity.sprite.originX + entity.sprite.width &&
      y >= entity.y - entity.sprite.originY && y < entity.y - entity.sprite.originY + entity.sprite.height)?.entity;
    if (!target) return false;
    if (selectedItemId) {
      if (target instanceof WorldItem) combineSelectedItem({ targetType: 'item', target: target.asset.definition.id });
      else if (target instanceof Character) combineSelectedItem({ targetType: 'character', target: target.characterId });
      else if (target instanceof AnimatedProp && target.propId) combineSelectedItem({ targetType: 'prop', target: target.propId });
    } else if (target instanceof WorldItem) {
      if (examine) runItemScript(target.asset.definition.examineScript);
      else {
        control.stop();
        addInventoryItem(target.asset.definition.id, {
          location: '<pickup>', getGlobal: (key) => runner.getGlobal(key),
          setGlobal: (key, value) => runner.setGlobal(key, value),
        }, gameContext);
        layout.appendLog(`Picked up ${target.asset.definition.label}.`);
      }
    }
    return true;
  }

  function syncPortraitReveal(side: 'left' | 'right', asset: PortraitAsset | undefined, actor: string | undefined, now: number): void {
    const isVisibleActor = shownPortraitAssets[side] !== undefined && shownPortraitActors[side] === actor;
    shownPortraitActors[side] = actor;
    if (shownPortraitAssets[side] === asset) return;
    portraitReveals[side]?.remove();
    delete portraitReveals[side];
    shownPortraitAssets[side] = asset;
    if (!asset || !portraitAnimationEnabled || isVisibleActor) return;
    portraitReveals[side] = {
      startedAtMs: now,
      durationMs: PORTRAIT_REVEAL_SEQUENCE.length * portraitStepDurationMs +
        Math.max(0, asset.height - 1) * portraitRowDelayMs,
      remove: filters.addFilter(createGlyphGrowthRevealFilter({
        stepDurationMs: portraitStepDurationMs,
        rowDelayMs: portraitRowDelayMs,
        growthSequences: [PORTRAIT_REVEAL_SEQUENCE],
        shortGrowthSequences: [PORTRAIT_REVEAL_SEQUENCE],
      }), () => layout.getPortraitScreenRect(side), now),
    };
  }

  function hasAnimatingPortrait(now: number): boolean {
    return Object.values(portraitReveals).some((reveal) => now - reveal.startedAtMs < reveal.durationMs);
  }

  function finishPortraitReveals(): void {
    for (const side of ['left', 'right'] as const) {
      portraitReveals[side]?.remove();
      delete portraitReveals[side];
    }
  }

  function clearPortraitExit(): void {
    for (const remove of portraitExit?.removeFilters ?? []) remove();
    portraitExit = undefined;
    layout.portraitExitVisible = false;
    delete shownPortraitAssets.left;
    delete shownPortraitAssets.right;
  }

  function startPortraitExit(now: number): void {
    const left = shownPortraitAssets.left;
    const right = layout.dialoguePanel.twoSpeakers ? shownPortraitAssets.right : undefined;
    if (!portraitAnimationEnabled || (!left && !right)) return;
    finishPortraitReveals();
    const elapsed = now - portraitStart;
    const durationMs = PORTRAIT_REVEAL_SEQUENCE.length * portraitStepDurationMs +
      Math.max(0, (left?.height ?? 0) - 1, (right?.height ?? 0) - 1) * portraitRowDelayMs;
    const removeFilters: (() => void)[] = [];
    for (const side of ['left', 'right'] as const) {
      if ((side === 'left' ? left : right))
        removeFilters.push(filters.addFilter(createGlyphExitFilter({
          stepDurationMs: portraitStepDurationMs,
          rowDelayMs: portraitRowDelayMs,
          glyphs: [...PORTRAIT_REVEAL_SEQUENCE].reverse().join(''),
        }), () => layout.getPortraitScreenRect(side), now));
    }
    portraitExit = {
      startedAtMs: now, durationMs,
      left: left ? { asset: left, frame: getPortraitFrameAt(left, elapsed) } : undefined,
      right: right ? { asset: right, frame: getPortraitFrameAt(right, elapsed) } : undefined,
      removeFilters,
    };
    layout.portraitExitVisible = true;
  }

  function advanceDialogue(): void {
    const now = Date.now();
    layout.message.advanceAnimation(now - dialogueUpdate);
    dialogueUpdate = now;
    if (!layout.message.isAnimationComplete() || hasAnimatingPortrait(now)) {
      layout.message.finishAnimation();
      finishPortraitReveals();
    }
    else runner?.advance();
  }
  function attachStepTriggers(): void {
    for (const entity of scene.entities) {
      if (!(entity instanceof Character) || entity.handleStep) continue;
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
    if (propSlides.cancel() || propPushChoices) cancelPropSlideInteraction();
    const loaded = await loadSceneById(sceneId);
    if (!opened) return;
    if (propSlides.cancel() || propPushChoices) cancelPropSlideInteraction();
    const marker = loaded.getMarker(markerName ?? 'mPlayer');
    if (!marker)
      layout.appendLog(`[RPGSCRIPT ERROR] ${location}: Scene ${sceneId} has no marker ${markerName ?? 'mPlayer'}; placing player at 0,0`, true);
    control.stop();
    runner?.clearSubscripts();
    const player = controlled.clone();
    player.stopWalking();
    player.x = marker?.x ?? 0;
    player.y = (marker?.y ?? 0) - player.bottomOffset;
    scene = cloneSessionScene(loaded, player);
    const restored = propSlideLayouts.restoreRoom(scene);
    authoredPropPositions = restored.defaults;
    if (restored.error) reportPropSlideRestoreError(restored.error);
    const acquired = runner?.getGlobal('vars.acquiredItems');
    if (Array.isArray(acquired)) scene.entities = scene.entities.filter((entity) =>
      !(entity instanceof WorldItem) || !acquired.includes(entity.asset.definition.id));
    selectedItemId = undefined;
    control.changeScene(scene, player);
    gameContext.scene = scene;
    layout.scene = scene;
    layout.clearBarks();
    pendingLoadTriggers = [...scene.triggers];
    runner?.restartTimers(scene.triggers);
    previousFrame = undefined;
    attachStepTriggers();
  }

  function cancelUiAndOpenLog(): void {
    if (!cancelPropSlideInteraction()) runner?.cancel();
    runner?.setStorage('dialogue.active', false);
    runner?.setStorage('dialogue.leftActor', undefined);
    runner?.setStorage('dialogue.rightActor', undefined);
    control.stop();
    control.endConversation(true);
    selectedItemId = undefined;
    mouseInput = '';
    finishPortraitReveals();
    clearPortraitExit();
    // Emergency cancellation must not play the normal portrait exit animation.
    layout.conversationOpen = false;
    layout.message.clearText();
    layout.clearBarks();
    layout.tabs.select('log');
    layout.tabs.getContent('log').scrollToEnd();
    paint(true);
  }

  const session: GameSession = {
    filters,
    cancelPropSlideInteraction,
    getPropSlideState: () => propSlideLayouts.getState(),
    getPortraitScreenRect: (side) => layout.getPortraitScreenRect(side),
    getSceneScreenRect: (area) => layout.getSceneScreenRect(area),
    id: randomUUID(),
    cols: 80,
    rows: 24,
    open() {
      opened = true;
      previousFrame = undefined;
      lastUpdate = Date.now();
      runner?.startTimers(scene.triggers, sessionTimerTriggers);
      dispatchLoadTriggers();
      scene.update(0);
      paint();
      refreshPortraits();
      if (animationTimer) clearTimeout(animationTimer);
      animationTimer = setTimeout(updateSimulation, FRAME_INTERVAL_MS);
    },
    input(data: string) {
      if (!opened || !data) return;
      if (data === TOGGLE_LOG_WINDOW_INPUT) {
        mouseInput = '';
        layout.toggleLogWindow();
        paint(true);
        return;
      }
      // Handle this before every modal input path, including partial mouse packets.
      if (hasCancelUiAndOpenLogInput(data)) {
        cancelUiAndOpenLog();
        return;
      }
      if (layout.logWindow.visible) {
        const pane = layout.logWindow;
        if (data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[5~' || data === '\x1b[6~') {
          pane.scrollY += data === '\x1b[A' ? -1 : data === '\x1b[B' ? 1
            : data === '\x1b[5~' ? -pane.innerHeight : pane.innerHeight;
          paint();
        }
        return;
      }
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
          if ((Number(match[1]) === 0 || Number(match[1]) === 2) && match[4] === 'M') {
            const examine = Number(match[1]) === 2;
            const x = Number(match[2]) - 1;
            const y = Number(match[3]) - 1;
            if (examine && (!runner?.isIdle() || runner.getStorage('dialogue.active') === true)) continue;
            if (runner?.centerToast !== undefined) {
              runner.dismissCenterToast();
              finishConversationIfIdle();
              dispatchLoadTriggers();
            } else if (runner?.dialogue) {
              advanceDialogue();
              finishConversationIfIdle();
              dispatchLoadTriggers();
            } else if (propPushChoices && !examine) {
              choosePropPushAt(x, y);
            } else if (runner?.isIdle() && runner.getStorage('dialogue.active') !== true) {
              const inventoryAction = layout.getInventoryActionAt(x, y);
              const tabId = !examine && layout.getTabAt(x, y);
              const point = layout.getScenePoint(x, y);
              if (tabId) layout.tabs.select(tabId);
              else if (inventoryAction) clickInventoryItem(inventoryAction.itemId, examine || inventoryAction.examine);
              else if (point && clickWorldItemTarget(point.x, point.y, examine)) {
                // Item interactions take precedence over scene action triggers.
              } else if (point && !examine && !selectedItemId && scene.propSlide &&
                activateSlideProp(scene.getVisiblePropAt(point.x, point.y))) {
                // The action is bound to the visible, moving instance.
              } else if (point && !examine && !selectedItemId)
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
      if (data === '\x1b' && selectedItemId) {
        selectedItemId = undefined;
        paint();
        return;
      }
      if (data === '\x1b' && propSlideInteraction) {
        cancelPropSlideInteraction();
        paint();
        return;
      }
      if (data === '\t' || data === '\x1b[Z') {
        if (runner?.centerToast !== undefined || propPushChoices) return;
        layout.tabs.selectNext(data === '\t' ? 1 : -1);
        paint();
        return;
      }
      if (data === '\x1b[A' || data === '\x1b[B' || data === '\x1b[5~' || data === '\x1b[6~') {
        if (runner?.centerToast !== undefined || propPushChoices) return;
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
        chooseScriptOption(Number(selected) - 1);
      } else if (runner.dialogue) {
        advanceDialogue();
      } else if ((data === '\r' || data === '\n') && runner.isIdle() &&
        runner.getStorage('dialogue.active') !== true && !selectedItemId && scene.propSlide) {
        activateSlideProp(getNearestVisibleSlideProp());
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
      cancelPropSlideInteraction();
      finishPortraitReveals();
      clearPortraitExit();
      delete shownPortraitAssets.left;
      delete shownPortraitAssets.right;
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
    if (runner?.isIdle()) {
      propSlideInteraction = false;
      propPushChoices = false;
      control.endConversation(true);
    }
  }

  function updateSimulation(): void {
    if (!opened) return;
    try {
      const now = Date.now();
      attachStepTriggers();
      scene.update(now - lastUpdate);
      layout.updateBarks(now - lastUpdate);
      control.update();
      propSlides.update(now - lastUpdate);
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
    try {
      const entries = getInventoryEntries(runner?.getGlobal('vars.inventory'), scene.itemAssets);
      layout.inventory.items = entries.flatMap((entry) => {
        const asset = scene.itemAssets.get(entry.itemId);
        return asset ? [asset] : [];
      });
      if (selectedItemId && !entries.some((entry) => entry.itemId === selectedItemId)) selectedItemId = undefined;
    } catch {
      // Script errors are reported by the command runner; a bad save must not crash rendering.
      layout.inventory.items = [];
      selectedItemId = undefined;
    }
    layout.inventory.selectedId = selectedItemId;
    layout.inventory.elapsedMs = Date.now();
    const wasConversationOpen = layout.conversationOpen;
    layout.conversationOpen = runner?.getStorage('dialogue.active') === true;
    const now = Date.now();
    if (layout.conversationOpen && portraitExit) clearPortraitExit();
    if (wasConversationOpen && !layout.conversationOpen) startPortraitExit(now);
    if (portraitExit && now - portraitExit.startedAtMs >= portraitExit.durationMs)
      clearPortraitExit();
    layout.centerToast.visible = runner?.centerToast !== undefined;
    if (runner?.centerToast !== undefined)
      layout.centerToast.setMessage(runner.centerToast, session.cols, session.rows);
    const leftActor = runner?.getStorage('dialogue.leftActor');
    const rightActor = runner?.getStorage('dialogue.rightActor');
    const paired = layout.conversationOpen && typeof leftActor === 'string' && typeof rightActor === 'string';
    const dialogue = runner?.dialogue;
    if (dialogue !== displayedDialogue) {
      displayedDialogue = dialogue;
      if (dialogue) layout.message.showText(dialogue.text);
      else layout.message.clearText();
      dialogueUpdate = Date.now();
    } else {
      const now = Date.now();
      layout.message.advanceAnimation(now - dialogueUpdate);
      dialogueUpdate = now;
    }
    const displayedActor = dialogue && getDisplayedActorName(dialogue.actor);
    const displayedLeft = typeof leftActor === 'string' ? getDisplayedActorName(leftActor) : undefined;
    const displayedRight = typeof rightActor === 'string' ? getDisplayedActorName(rightActor) : undefined;
    if (!portraitExit) {
      inactiveLeftPortrait = paired && displayedLeft !== undefined && displayedActor !== displayedLeft;
      inactiveRightPortrait = paired && displayedRight !== undefined && displayedActor !== displayedRight;
    }
    layout.dialoguePanel.advanceHint.visible = runner?.dialogue !== undefined;
    if (!portraitExit) {
      if (paired && displayedLeft && displayedRight)
        layout.dialoguePanel.setSpeakers(displayedLeft, displayedRight, displayedActor);
      else layout.dialoguePanel.setSpeaker(displayedActor);
    }
    layout.pushPad.setChoices(propPushChoices ? runner?.choice?.options : undefined);
    layout.choiceMessage.text = propPushChoices ? '' :
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
    const portrait = portraitExit?.left?.asset ?? selection?.asset;
    const rightPortrait = portraitExit?.right?.asset ?? rightSelection?.asset;
    if (!portraitExit) {
      syncPortraitReveal('left', portrait, paired ? displayedLeft : displayedActor, now);
      syncPortraitReveal('right', rightPortrait, paired ? displayedRight : undefined, now);
    }
    const elapsed = now - portraitStart;
    layout.dialoguePanel.setPortrait(
      portrait,
      portraitExit?.left?.frame ?? (portrait ? getPortraitFrameAt(portrait, elapsed) : undefined),
    );
    layout.dialoguePanel.setRightPortrait(
      rightPortrait,
      portraitExit?.right?.frame ?? (rightPortrait ? getPortraitFrameAt(rightPortrait, elapsed) : undefined),
    );
    layout.render(buffer);
    if (!layout.logWindow.visible) filters.applyFilters(buffer);
    const frame = encodeTerminalDiff(buffer, previousFrame);
    if (frame || needsFrame) {
      send(
        frame || encodeTerminal(buffer, { clear: false, fullScreen: true }),
        session.cols,
        session.rows,
        layout.getLogSelectionRect(),
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
