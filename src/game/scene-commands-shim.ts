import { commands } from './scene-commands.js';
import { getSpawnTarget } from './scene-command-support/character-spawn.js';
import {
  getAnimationStateName, getBark, getBusyState, getCharacterVariantName, getFacingDirection,
  getPlayerCharacterName, getPositionCoordinates, getPropInstanceName, getSkipWait,
  getSpeedMultiplier, getWaitMilliseconds, getWalkDestination, getWalkOffset,
} from './scene-command-support/arguments.js';
import { addNamedInventoryItem, getItemName } from './scene-command-support/inventory.js';
import { getDialogueActorName, getDialoguePortrait, type PortraitAssets } from './portrait-assets.js';
import type { ScriptLibrary, ScriptRunner } from './rpgscript/runtime.js';
import { parseRpgScript, ScriptRunner as Runner } from './rpgscript/runtime.js';
import { defineCommand } from './rpgscript/command.js';

const getCharacterPos = defineCommand({
  returnsValue: true,
  parse: commands.getCharacterPos.parse,
  execute: (step, script) => {
    getPlayerCharacterName(step.character, script, 'getCharacterPos');
    throw new Error(`${script.location}: getCharacterPos requires a world scene`);
  },
});

function throwPropSlideWithoutScene(_step: unknown, script: { location: string }): never {
  throw new Error(`${script.location}: Prop slide commands require a game session`);
}

// A terminal has no player character. Validate the command without controlling a scene.
export const sceneCommandsShim = {
  ...commands,
  approachSlideProp: defineCommand({
    returnsValue: true, parse: commands.approachSlideProp.parse, execute: throwPropSlideWithoutScene,
  }),
  getPropPushes: defineCommand({
    returnsValue: true, parse: commands.getPropPushes.parse, execute: throwPropSlideWithoutScene,
  }),
  choosePropPush: defineCommand({
    returnsValue: true, parse: commands.choosePropPush.parse, execute: throwPropSlideWithoutScene,
  }),
  slideProp: defineCommand({
    returnsValue: true, parse: commands.slideProp.parse, execute: throwPropSlideWithoutScene,
  }),
  resetPropSlides: defineCommand({
    returnsValue: true, parse: commands.resetPropSlides.parse, execute: throwPropSlideWithoutScene,
  }),
  getPropClimbPath: defineCommand({
    returnsValue: true, parse: commands.getPropClimbPath.parse, execute: throwPropSlideWithoutScene,
  }),
  getMarkerPos: defineCommand({
    returnsValue: true,
    parse: commands.getMarkerPos.parse,
    execute: (_step, script) => { throw new Error(`${script.location}: getMarkerPos requires a world scene`); },
  }),
  playDialogue: defineCommand({
    parse: commands.playDialogue.parse,
    execute: (step, script) =>
      script.showDialogue(script.interpolate(step.actor), script.interpolate(step.text), step.emotion, undefined, step.voice),
  }),
  setConv: defineCommand({
    parse: commands.setConv.parse,
    execute: (step, script) => commands.setConv.run({ ...step, command: 'setConv', line: 0 }, script, undefined),
  }),
  setConv2: defineCommand({
    parse: commands.setConv2.parse,
    execute: (step, script) => commands.setConv2.run({ ...step, command: 'setConv2', line: 0 }, script, undefined),
  }),
  setCharacterVariant: defineCommand({
    parse: commands.setCharacterVariant.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'setCharacterVariant');
      getCharacterVariantName(step.variant, script);
    },
  }),
  acquireItem: defineCommand({
    parse: commands.acquireItem.parse,
    execute: (step, script) => commands.acquireItem.run({ ...step, command: 'acquireItem', line: 0 }, script, undefined),
  }),
  addItem: defineCommand({
    parse: commands.addItem.parse,
    execute: (step, script) => {
      addNamedInventoryItem(getItemName(step.item, script, 'addItem'), script);
    },
  }),
  removeItem: defineCommand({
    parse: commands.removeItem.parse,
    execute: (step, script) => commands.removeItem.run({ ...step, command: 'removeItem', line: 0 }, script, undefined),
  }),
  examineItem: defineCommand({
    parse: commands.examineItem.parse,
    execute: (_step, script) => { throw new Error(`${script.location}: examineItem requires a world scene`); },
  }),
  combineItem: defineCommand({
    parse: commands.combineItem.parse,
    execute: (_step, script) => { throw new Error(`${script.location}: combineItem requires a world scene`); },
  }),
  setBusy: defineCommand({
    parse: commands.setBusy.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'setBusy');
      getBusyState(step.busy, script);
    },
  }),
  callChSubscript: defineCommand({
    parse: commands.callChSubscript.parse,
    execute: (step, script) => {
      const name = getPlayerCharacterName(step.character, script, 'callChSubscript');
      script.callSubscript(name, step.target);
    },
    targets: (step) => [{ name: step.target, argumentCount: 1 }],
  }),
  getCharacterPos,
  getChPos: getCharacterPos,
  setChForeground: defineCommand({
    parse: commands.setChForeground.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'setChForeground');
      getBusyState(step.foreground, script, 'setChForeground');
    },
  }),
  getPropPos: defineCommand({
    returnsValue: true,
    parse: commands.getPropPos.parse,
    execute: (step, script) => {
      getPropInstanceName(step.prop, script, 'getPropPos');
      throw new Error(`${script.location}: getPropPos requires a world scene`);
    },
  }),
  setChPos: defineCommand({
    parse: commands.setChPos.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.entity, script, 'setChPos');
      getPositionCoordinates(step, script, 'setChPos');
    },
  }),
  setPropPos: defineCommand({
    parse: commands.setPropPos.parse,
    execute: (step, script) => {
      getPropInstanceName(step.entity, script, 'setPropPos');
      getPositionCoordinates(step, script, 'setPropPos');
    },
  }),
  chWalkToCoord: defineCommand({
    parse: commands.chWalkToCoord.parse,
    execute: (step, script) => {
      getWalkDestination(step, script);
    },
  }),
  walkToMarker: defineCommand({
    parse: commands.walkToMarker.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'walkToMarker');
      const marker = script.value(step.marker);
      getSkipWait(step.skipWait, script);
      if (typeof marker !== 'string' || !marker.trim())
        throw new Error(`${script.location}: walkToMarker requires a marker name`);
    },
  }),
  walkToMarkerInt: defineCommand({
    parse: commands.walkToMarkerInt.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'walkToMarkerInt');
      const marker = script.value(step.marker);
      if (typeof marker !== 'string' || !marker.trim())
        throw new Error(`${script.location}: walkToMarkerInt requires a marker name`);
    },
  }),
  walkToOffset: defineCommand({
    parse: commands.walkToOffset.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'walkToOffset');
      getWalkOffset(step, script);
      getSkipWait(step.skipWait, script, 'walkToOffset');
    },
  }),
  stopCh: defineCommand({
    parse: commands.stopCh.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'stopCh');
    },
  }),
  setSpeedMult: defineCommand({
    parse: commands.setSpeedMult.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'setSpeedMult');
      getSpeedMultiplier(step.mult, script);
    },
  }),
  setFacing: defineCommand({
    parse: commands.setFacing.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'setFacing');
      getFacingDirection(step.direction, script);
    },
  }),
  lookAtCh: defineCommand({
    parse: commands.lookAtCh.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'lookAtCh');
      getPlayerCharacterName(step.target, script, 'lookAtCh');
    },
  }),
  lookAtMarker: defineCommand({
    parse: commands.lookAtMarker.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'lookAtMarker');
      const marker = script.value(step.marker);
      if (typeof marker !== 'string' || !marker.trim())
        throw new Error(`${script.location}: lookAtMarker requires a marker name`);
    },
  }),
  bark: defineCommand({
    parse: commands.bark.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.target, script, 'bark');
      getBark(step, script);
    },
  }),
  barkProp: defineCommand({
    parse: commands.barkProp.parse,
    execute: (step, script) => {
      getPropInstanceName(step.target, script, 'barkProp');
      getBark(step, script, 'barkProp');
    },
  }),
  setAnimState: defineCommand({
    parse: commands.setAnimState.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'setAnimState');
      getAnimationStateName(step.state, script);
    },
  }),
  setPropAnimState: defineCommand({
    parse: commands.setPropAnimState.parse,
    execute: (step, script) => {
      getPropInstanceName(step.prop, script);
      getAnimationStateName(step.state, script, 'setPropAnimState');
    },
  }),
  spawnCh: defineCommand({
    parse: commands.spawnCh.parse,
    execute: (step, script) => { getSpawnTarget(step, script); },
  }),
  despawnCh: defineCommand({
    parse: commands.despawnCh.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.character, script, 'despawnCh');
    },
  }),
  waitMs: defineCommand({
    parse: commands.waitMs.parse,
    execute: (step, script) => {
      getWaitMilliseconds(step.ms, script);
    },
  }),
  fadeOut: defineCommand({
    parse: commands.fadeOut.parse,
    execute: (step, script) => { getWaitMilliseconds(step.ms, script, 'fadeOut'); },
  }),
  fadeIn: defineCommand({
    parse: commands.fadeIn.parse,
    execute: (step, script) => { getWaitMilliseconds(step.ms, script, 'fadeIn'); },
  }),
  getSceneId: defineCommand({
    returnsValue: true,
    parse: commands.getSceneId.parse,
    execute: (_step, script) => { throw new Error(`${script.location}: getSceneId requires a world scene`); },
  }),
  getSceneName: defineCommand({
    returnsValue: true,
    parse: commands.getSceneName.parse,
    execute: (_step, script) => { throw new Error(`${script.location}: getSceneName requires a world scene`); },
  }),
  changeScene: defineCommand({
    parse: commands.changeScene.parse,
    execute: (step, script) => {
      const sceneId = script.value(step.sceneId);
      const markerName = step.markerName === undefined ? undefined : script.value(step.markerName);
      if (typeof sceneId !== 'string' || !sceneId.trim())
        throw new Error(`${script.location}: changeScene requires a scene ID`);
      if (markerName !== undefined && (typeof markerName !== 'string' || !markerName.trim()))
        throw new Error(`${script.location}: changeScene requires a marker name`);
    },
  }),
  setPlayerWalkCh: defineCommand({
    parse: commands.setPlayerWalkCh.parse,
    execute: (step, script) => {
      getPlayerCharacterName(step.idOrInstanceName, script);
      if (step.variant !== undefined)
        getCharacterVariantName(step.variant, script, 'setPlayerWalkCh');
    },
  }),
  endConv: defineCommand({
    parse: commands.endConv.parse,
    execute: (_step, script) => {
      script.setStorage('dialogue.active', false);
      script.setStorage('dialogue.leftActor', undefined);
      script.setStorage('dialogue.rightActor', undefined);
    },
  }),
  endConvNR: defineCommand({
    parse: commands.endConvNR.parse,
    execute: (_step, script) => {
      script.setStorage('dialogue.active', false);
      script.setStorage('dialogue.leftActor', undefined);
      script.setStorage('dialogue.rightActor', undefined);
    },
  }),
};

export type ShimIO = {
  writeLine: (text: string) => void;
  writeLog?: (text: string) => void;
  promptChoice: (options: readonly string[]) => Promise<number>;
  portraits?: PortraitAssets;
};

function printPortrait(io: ShimIO, actor: string, emotion: string | undefined): void {
  const frame = getDialoguePortrait(io.portraits, actor, emotion)?.asset.frames[0];
  if (!frame?.cells) return;
  for (let y = 0; y < frame.height; y++) {
    io.writeLine(
      frame.cells
        .slice(y * frame.width, (y + 1) * frame.width)
        .map((cell) => cell.ch)
        .join(''),
    );
  }
  io.writeLine('');
}

export async function runSceneCommandsShim(
  runner: ScriptRunner<ShimIO>,
  io: ShimIO,
): Promise<void> {
  while (!runner.isIdle()) {
    if (runner.centerToast !== undefined) {
      io.writeLine(runner.centerToast);
      runner.dismissCenterToast();
    } else if (runner.dialogue) {
      if (runner.getStorage('dialogue.active') === true)
        printPortrait(io, runner.dialogue.actor, runner.dialogue.emotion);
       io.writeLine(`${getDialogueActorName(io.portraits, runner.dialogue.actor)}: ${runner.dialogue.text}`);
      runner.advance();
    } else if (runner.choice) {
      if (runner.choice.question) io.writeLine(runner.choice.question);
      const index = await io.promptChoice(runner.choice.options);
      runner.choose(index);
    } else {
      throw new Error('RPGScript paused without dialogue or choices');
    }
  }
}

export async function runRpgScriptSnippet(
  library: ScriptLibrary,
  snippet: string,
  io: ShimIO,
): Promise<ScriptRunner<ShimIO>> {
  const source = snippet.trim();
  if (!source) throw new Error('Expected an RPGScript snippet');
  const entry = '__terminal_snippet__';
  if (library.has(entry)) throw new Error(`RPGScript ${entry} is reserved for terminal snippets`);
  const call = /^([\w-]+)\(\s*\)$/.exec(source);
  const body = call
    ? `+callScript(${call[1]})`
    : source
        .split(/\r?\n/)
        .map((line) => (/^[\w-]+\(/.test(line.trim()) ? `+${line.trim()}` : line))
        .join('\n');
  const inline = parseRpgScript(`@${entry}\n${body}`, '<terminal>', {
    commands: sceneCommandsShim,
  });
  const scripts = Object.assign(new Map([...library, ...inline]), {
    triggers: library.triggers,
  });
  const runner = new Runner(scripts, {
    commands: sceneCommandsShim,
    context: io,
    writeLog: io.writeLog ?? io.writeLine,
  });
  runner.start(entry);
  await runSceneCommandsShim(runner, io);
  return runner;
}
