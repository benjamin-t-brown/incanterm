import { CutsceneSpeaker } from 'model/store';
import { characterSetFacing, characterGetPos } from 'model/character';
import { Facing, AnimationState } from 'model/character-type';
import {
  Marker,
  TileLayerPrefix,
  roomGetCharacterByName,
  roomGetTileLayer,
  roomGetTileLayerPrefixForCharacter,
} from 'model/room';
import {
  getCurrentRoom,
  getCurrentPlayer,
  setNextMusicToPlayAfterSkip,
} from 'model/generics';
import { Point } from 'utils';
import { EmotionBubble } from '_db/effects';
import { getIfExists as getItem } from '_db/items';
import {
  playerAddItem,
  playerRemoveItem,
  playerModifyTokens,
  playerModifyTickets,
} from 'model/player';
import { ParticleTemplate } from 'model/particle';
import SC from 'controller/scene/scene-commands';
import { showChoices, startConversation } from 'controller/ui-actions';
import { walkPartyToFormationOverworld } from 'controller/overworld-management';
import { stopCurrentMusic } from 'model/sound';
import { dropCurrentlyHeldProps } from 'controller/overworld-management/overworld-management-props';
import { getSceneForCommands } from 'controller/scene-management';

const lastDialogSkipped = {
  actorName: '',
  text: '',
};

const log = (text: string) => {
  return SC.log(text);
};

const assert = (expr: string, exprOnFailure?: string) => {
  return SC.assert(expr, exprOnFailure);
};

const sbreak = () => {
  return SC.sbreak();
};

const loop = (
  scriptName: string,
  numTimes: number,
  indOffset?: number | string
) => {
  return SC.loop(scriptName, numTimes, indOffset);
};

const loopExpr = (expr: string, numTimes: number) => {
  return SC.loopExpr(expr, numTimes);
};

export const playDialogue = (args: {
  actorName: string;
  text: string;
  soundName?: string;
  portraitEmotion?: string;
}) => {
  // console.trace('SKIP PLAY DIAG', actorName, text);
  lastDialogSkipped.actorName = args.actorName;
  lastDialogSkipped.text = args.text;
  // console.log('SKIP DIALOG', actorName, text);
  return;
};

export const setConversation2 = (
  actorNameLeft: string,
  actorNameRight: string
) => {
  return;
};

export const setConversation = (actorName: string) => {
  return;
};

export const setConversationWithoutBars = (actorName: string) => {
  return;
};

export const setConversationGroup = (ms?: number, ...actorNames: string[]) => {
  // might break conversations after a skip unless these actors are saved somewhere as well
  // as any associated calls to setConversation
  return;
};

export const replaceConversationMember2 = (
  actorName: string,
  side: 'left' | 'right'
) => {
  return;
};

export const setUnskippableConversation = () => {
  return;
};

export const setUnskippable = () => {
  return;
};

export const endConversation = (ms?: number, dontHideCutscene?: boolean) => {
  return SC.endConversation(0, dontHideCutscene);
};

export const resumeGame = () => {
  SC.resumeGame();
};

export const setConversationSpeaker = (speaker: CutsceneSpeaker) => {
  return;
};

export const none = () => {
  setConversationSpeaker(CutsceneSpeaker.None);
};

export const setFromDialog = (chName: string) => {
  return;
};

/**
 * Waits for the specified number of milliseconds, ignoring all user input until that time.
 *
 * The `cb` argument is not to be used in rpgscript, and only for internal use.
 */
export const waitMS = (ms: number, cb?: () => void) => {
  return;
};

/**
 * Waits for the specified number of milliseconds, but can be interrupted by a user pressing
 * the action key.
 *
 * The `cb` argument is not to be used in rpgscript, and only for internal use.
 *
 * ```
 * @test-waitMSPreemptible
 * +setConversation('Conscience');
 * Conscience: "This script tests waitMSPreemptible."
 * Conscience: "I will now stare awkwardly for 10 seconds.  At any time you may interrupt me and I will resume my normal, suave functionality."
 * +setConversationSpeaker('center');
 * +waitMSPreemptible(10000);
 * Conscience: "Boom!  I'm back."
 * Conscience: "The test will now conclude."
 * +endConversation();
 * ```
 */
export const waitMSPreemptible = (ms: number, cb: () => void) => {
  return;
};

/**
 * (Internal use only.)
 */
const waitUntil = () => {
  const scene = getSceneForCommands();
  scene.isWaitingForTime = true;
  return () => {
    scene.isWaitingForTime = false;
  };
};

/**
 * (Internal use only.)
 */
const waitForUserInput = (cb?: () => void) => {
  return;
};

/**
 * (Internal use only.)
 */
const waitForUserInputDialog = (cb?: () => void) => {
  return;
};

/**
 * Sets a key/value pair on a player's save file.  Useful setting variables.
 */
export const setStorage = (
  key: string,
  value: string | boolean | number,
  isOnce?: boolean
) => {
  return SC.setStorage(key, value, isOnce);
};

export const setStorageValueAt = (key: string, value: string) => {
  return SC.setStorageValueAt(key, value);
};

export const setStorageCond = (key: string, expr: string) => {
  return SC.setStorageCond(key, expr);
};

export const setStorageEval = (key: string, expr: string) => {
  return SC.setStorageEval(key, expr);
};

export const incrementStorage = (key: string, value: number) => {
  return SC.incrementStorage(key, value);
};

export const setStorageIfNotSet = (
  key: string,
  value: string | boolean | number
) => {
  return SC.setStorageIfNotSet(key, value);
};

export const callScript = (scriptName: string, ...args: any[]) => {
  SC.callScript(scriptName, ...args);
  return true;
};

export const lookAtCharacter = (chName: string, targetChName: string) => {
  SC.lookAtCharacter(chName, targetChName);
};

export const partyLookAtCharacter = (targetChName: string) => {
  SC.partyLookAtCharacter(targetChName);
};

export const lookAtMarker = (chName: string, markerName: string) => {
  SC.lookAtMarker(chName, markerName);
};

export const partyLookAtMarker = (markerName: string) => {
  SC.partyLookAtMarker(markerName);
};

export const lookAtEachOther = (chName1: string, chName2: string) => {
  lookAtCharacter(chName1, chName2);
  lookAtCharacter(chName2, chName1);
};

export const lookAtCenterOfTrigger = (chName1: string) => {
  SC.lookAtCenterOfTrigger(chName1);
};

export const setFacing = (chName: string, facing: Facing) => {
  SC.setFacing(chName, facing);
};

export const partySetFacing = (facing: Facing) => {
  SC.partySetFacing(facing);
};

export const shakeScreen = (ms?: number) => {
  return;
};

export const setCharacterAt = (
  chName: string,
  x: number,
  y: number,
  z?: number
) => {
  SC.setCharacterAt(chName, x, y, z);
};

export const offsetCharacter = (
  chName: string,
  x: number,
  y: number,
  z?: number
) => {
  SC.offsetCharacter(chName, x, y, z);
};

export const walkToMarker = (
  chName: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number,
  skipWait?: boolean
) => {
  SC.setAtMarker(chName, markerName, xOffset, yOffset);
};

export const walkToPoint = (
  chName: string,
  x: number,
  y: number,
  xOffset?: number,
  yOffset?: number,
  skipWait?: boolean
) => {
  const ch = roomGetCharacterByName(getCurrentRoom(), chName);
  if (ch) {
    const tileLayer = roomGetTileLayerPrefixForCharacter(getCurrentRoom(), ch);
    const z = roomGetTileLayer(getCurrentRoom(), tileLayer);
    SC.setAtPoint(chName, x, y, z.zOffset, xOffset, yOffset);
  }
};

export const setAtPoint = (
  chName: string,
  x: number,
  y: number,
  z: number,
  xOffset?: number,
  yOffset?: number
) => {
  SC.setAtPoint(chName, x, y, z, xOffset, yOffset);
};

export const walkToCharacter = (
  chName: string,
  chName2: string,
  xOffset?: number,
  yOffset?: number,
  skipWait?: boolean
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const ch2 = roomGetCharacterByName(room, chName2);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        walkToCharacter(ch.name, chName2, xOffset, yOffset, skipWait);
      }
    });
    return;
  }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (!ch2) {
    console.error('Could not find target ch with name: ' + chName2);
    return;
  }
  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number');
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number');
    return;
  }

  const [pX, pY] = characterGetPos(ch2);
  const target = [pX + (xOffset ?? 0), pY + (yOffset ?? 0)] as Point;
  setCharacterAt(chName, target[0], target[1], 0);
};

export const walkPartyToFormation = (skipWait?: boolean, offset?: number) => {
  const player = getCurrentPlayer();
  const cb = () => {
    player.party.forEach(ch => {
      if (ch !== player.leader) {
        characterSetFacing(ch, player.leader.facing);
      }
    });
  };
  walkPartyToFormationOverworld(player.leader, {
    facing: undefined,
    skipWalk: true,
    offset,
  }).then(cb);
};

export const setAtMarker = (
  chName: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  SC.setAtMarker(chName, markerName, xOffset, yOffset);
};

export const walkToOffset = (
  chName: string,
  xOffset: number,
  yOffset: number,
  skipWait?: boolean
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        walkToOffset(ch.name, xOffset, yOffset);
      }
    });
    return;
  }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number');
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number');
    return;
  }

  const target = [ch.x + xOffset, ch.y + yOffset] as Point;
  setCharacterAt(chName, target[0], target[1], 0);
};

export const setCharacterAtMarker = (
  chName: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  SC.setCharacterAtMarker(chName, markerName, xOffset, yOffset);
};

export const setCharacterAtCharacter = (
  chName: string,
  ch2Name: string,
  xOffset?: number,
  yOffset?: number
) => {
  SC.setCharacterAtMarker(chName, ch2Name, xOffset, yOffset);
};

export const changeTileAtMarker = (
  markerName: string | Marker,
  tileTemplateName: string,
  xOffset?: number,
  yOffset?: number
) => {
  SC.changeTileAtMarker(markerName, tileTemplateName, xOffset, yOffset);
};

export const addOrReplaceTileAtMarkerEx = (
  markerName: string | Marker,
  tileTemplateName: string,
  xOffset?: number,
  yOffset?: number
) => {
  SC.addOrReplaceTileAtMarkerEx(markerName, tileTemplateName, xOffset, yOffset);
};

export const addOrReplaceTileAtPositionEx = (
  x: number | string,
  y: number | string,
  tileTemplateName: string
) => {
  SC.addOrReplaceTileAtPositionEx(x, y, tileTemplateName);
};

export const removeWallAtMarker = (
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  SC.removeWallAtMarker(markerName, xOffset, yOffset);
};

export const changeTileAtPosition = (
  x: number,
  y: number,
  tileLayerPrefix: TileLayerPrefix,
  tileTemplateName: string
) => {
  return SC.changeTileAtPosition(x, y, tileTemplateName, tileLayerPrefix);
};

export const removeWallAtTilePosition = (tileX: number, tileY: number) => {
  SC.removeWallAtTilePosition(tileX, tileY);
};

export const spawnCharacterAtCharacter = (
  chTemplateName: string,
  chName: string,
  xOffset?: number,
  yOffset?: number
) => {
  SC.spawnCharacterAtCharacter(chTemplateName, chName, xOffset, yOffset);
};

export const spawnCharacterAtMarker = (
  chTemplateName: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  SC.spawnCharacterAtMarker(chTemplateName, markerName, xOffset, yOffset);
};

export const spawnPartyMembers = () => {
  SC.spawnPartyMembers(true);
};

export const despawnPartyMembers = () => {
  SC.despawnPartyMembers(true);
};

export const spawnPartyMembersInFormation = () => {
  const room = getCurrentRoom();
  const player = getCurrentPlayer();
  const partyWithoutLeader = player.partyStorage.filter(
    ch => ch !== player.leader
  );

  const d = 16;
  const offsets = [
    [d, 1],
    [1, -d],
    [-d, 1],
    [1, d],
  ];

  partyWithoutLeader.forEach((chTemplate, i) => {
    const offset = offsets[i];
    spawnCharacterAtCharacter(
      chTemplate.name,
      player.leader.name,
      offset?.[0],
      offset?.[1]
    );
  });

  player.party.forEach(chTemplate => {
    const ch = roomGetCharacterByName(room, chTemplate.name);
    if (ch) {
      characterSetFacing(ch, Facing.DOWN);
    }
  });
};

export const setPartyAtFormation = (d = 16) => {
  return SC.setPartyAtFormation(d);
};

export const despawnCharacter = (chName: string) => {
  SC.despawnCharacter(chName);
};

export const fadeOut = (ms?: number, skipWait?: boolean) => {
  const canvasContainer = document.getElementById('fade');
  if (canvasContainer) {
    canvasContainer.style.transition = `unset`;
    canvasContainer.style['background-color'] = 'rgba(0, 0, 0, 255)';
  }
};

export const fadeIn = (ms?: number, skipWait?: boolean) => {
  const canvasContainer = document.getElementById('fade');
  if (canvasContainer) {
    canvasContainer.style.transition = `unset`;
    canvasContainer.style['background-color'] = 'rgba(0, 0, 0, 0)';
  }
};

export const fadeOutColor = (
  r: number,
  g: number,
  b: number,
  ms?: number,
  skipWait?: boolean
) => {
  const canvasContainer = document.getElementById('fade');
  if (canvasContainer) {
    canvasContainer.style.transition = `unset`;
    canvasContainer.style['background-color'] = `rgba(${r}, ${g}, ${b}, 255)`;
  }
};

export const fadeInColor = (
  r: number,
  g: number,
  b: number,
  ms?: number,
  skipWait?: boolean
) => {
  const canvasContainer = document.getElementById('fade');
  if (canvasContainer) {
    canvasContainer.style.transition = `unset`;
    canvasContainer.style['background-color'] = `rgba(${r}, ${g}, ${b}, 0)`;
  }
};

export const changeRoom = async (
  roomName: string,
  nextRoomMarkerName?: string
) => {
  SC.changeRoom(roomName, nextRoomMarkerName);
};

export const acquireItem = (itemName: string, itemText?: string) => {
  const player = getCurrentPlayer();
  const item = getItem(itemName);
  if (!item) {
    console.error(
      `Cannot acquire item "${itemName}" no template exists with that name.`
    );
    return;
  }

  playerAddItem(player, itemName);
};

export const acquireQuestItem = (itemName: string, itemText?: string) => {
  const player = getCurrentPlayer();
  playerAddItem(player, itemName);
};

export const removeItem = (itemName: string, itemText?: string) => {
  const player = getCurrentPlayer();
  playerRemoveItem(player, itemName);
};

export const modifyTokens = (amount: number) => {
  const player = getCurrentPlayer();
  playerModifyTokens(player, amount);
};

export const modifyTickets = (amount: number) => {
  const player = getCurrentPlayer();
  playerModifyTickets(player, amount);
};

export const jump = (chName: string) => {
  return;
};

export const applyZTransform = (
  chName: string,
  z: number,
  ms?: number,
  includeFloor?: boolean,
  skipWait?: boolean
) => {
  // const room = getCurrentRoom();
  // const ch = roomGetCharacterByName(room, chName);

  // if (!ch) {
  //   console.error('Could not find character with name: ' + chName);
  //   return;
  // }

  // const startPoint = characterGetPos(ch);
  // const endPoint = [...startPoint] as Point3d;
  // endPoint[2] += z;

  // characterSetPos(ch, endPoint);
  return SC.applyZTransform(chName, z, 1, includeFloor, true);
};

export const applyZTransformTileAtMarker = (
  markerName: string,
  z: number,
  ms?: number,
  skipWait?: boolean
) => {
  return SC.applyZTransformTileAtMarker(markerName, z, 1, true);
};

export const applyZTransformTileAtMarkerEx = (
  markerName: string,
  z: number,
  xOffset?: number,
  yOffset?: number,
  ms?: number,
  skipWait?: boolean
) => {
  return SC.applyZTransformTileAtMarkerEx(
    markerName,
    z,
    xOffset,
    yOffset,
    1,
    true
  );
};

export const runArcadeCabinetGame = (gameName: string) => {
  return SC.runArcadeCabinetGame(gameName);
};

export const hideCurrentArcadeGame = () => {
  return SC.hideCurrentArcadeGame();
};

export const setAnimationAndWait = (
  chName: string,
  animName: string,
  msOffset?: number
) => {
  return;
};

export const setAnimation = (chName: string, animName: string) => {
  return SC.setAnimation(chName, animName);
};

export const setAnimationState = (chName: string, state: AnimationState) => {
  return SC.setAnimationState(chName, state);
};

export const setSpeed = (chName: string, speed: number) => {
  return SC.setSpeed(chName, speed);
};

export const resetAi = (chName: string) => {
  SC.resetAi(chName);
};
export const startAi = resetAi;

export const stopAi = (chName: string) => {
  SC.stopAi(chName);
};

export const setDoorStateAtMarker = (
  markerName: string,
  tileBase: string,
  doorDirection: string | 'BCK' | 'FWD',
  doorState: string | 'OPEN' | 'CLOSED'
) => {
  SC.setDoorStateAtMarker(markerName, tileBase, doorDirection, doorState);
};

export const awaitChoice = (...choices: string[]) => {
  stopSkipCutscene();
  SC.playDialogue({
    actorName: lastDialogSkipped.actorName || 'Narrator',
    text: lastDialogSkipped.text,
  });
  setTimeout(() => {
    showChoices(choices, false);
  }, 250);
  return waitUntil();
};

export const awaitChoiceEx = (type: string, ...choices: string[]) => {
  stopSkipCutscene();
  if (type === 'reverse') {
    getSceneForCommands().skip = false;
    SC.playDialogue({
      actorName: lastDialogSkipped.actorName,
      text: lastDialogSkipped.text,
    });
    setTimeout(() => {
      showChoices(choices, true);
    }, 250);
    return waitUntil();
  }
  if (type === 'array') {
    const newChoices = choices?.[0]?.split(',').filter(item => !!item) ?? [
      undefined,
    ];
    newChoices.forEach((c, i) => {
      setStorage(`CHOICE${i}`, c);
    });
    SC.playDialogue({
      actorName: lastDialogSkipped.actorName,
      text: lastDialogSkipped.text,
      dontWaitForInput: true,
    });
    setTimeout(() => {
      showChoices(newChoices, false);
    }, 250);
    return waitUntil();
  }
  return awaitChoice(...choices);
};

export const enterCombat = (encounterName: string) => {
  return SC.enterCombat(encounterName);
};

export const addPartyMemberToActiveParty = (chName: string) => {
  SC.addPartyMemberToActiveParty(chName);
};

export const removePartyMemberFromActiveParty = (chName: string) => {
  SC.removePartyMemberFromActiveParty(chName);
};

export const panCameraRelativeToPlayer = (
  relX: number,
  relY: number,
  ms?: number,
  skipWait?: boolean
) => {
  return SC.panCameraRelativeToPlayer(relX, relY, 1, true);
};

export const panCameraRelativeToCurrentPosition = () => {};

export const panCameraBackToPlayer = (ms?: number, skipWait?: boolean) => {
  return SC.panCameraBackToPlayer(1, true);
};

export const panCameraToMarker = (
  markerName: string,
  ms?: number,
  skipWait?: boolean
) => {
  return SC.panCameraToMarker(markerName, 1, true);
};

export const panCameraToFitCharacters = (
  ms?: number,
  skipWait?: boolean,
  ...characterNames: string[]
) => {
  return SC.panCameraToFitCharacters(1, true, ...characterNames);
};

export const panCameraBattle = () => {};

export const playSound = (soundName: string) => {
  return;
};

export const playMusic = async (musicName: string) => {
  setNextMusicToPlayAfterSkip(musicName);
  // return playMusicName(musicName, true);
};

export const stopMusic = async () => {
  stopCurrentMusic();
  // // artificially delay this, Music clobbers itself otherwise when stopping and starting
  // // too quickly
  // return waitMS(10);
};

export const spawnParticleEx = () => {
  return;
};

export const spawnParticleAtTarget = (
  template: ParticleTemplate,
  target: Point,
  particleMethod: 'normal' | 'weighted' | 'rise' | 'credits',
  text?: string
) => {
  return;
};

export const spawnParticleAtCharacter = (
  particleName: string,
  chName: string,
  particleMethod: 'normal' | 'weighted' | 'rise'
) => {
  return;
};

export const spawnEmotionParticleAtCharacter = (
  chName: string,
  emotion: EmotionBubble
) => {
  return;
};

export const spawnParticleAtMarker = (
  particleName: string,
  markerName: string,
  particleMethod: 'normal' | 'weighted' | 'rise'
) => {
  return;
};

export const setCharacterText = (text: string) => {
  return;
};

export const showUISection = (sectionName: string, ...args: any[]) => {
  return SC.showUISection(sectionName, ...args);
};

export const pauseOverworld = () => {
  SC.pauseOverworld();
};

export const unpauseOverworld = () => {
  SC.unpauseOverworld();
};

export const equipWeaponOrArmor = (itemName: string, chName: string) => {
  return SC.equipWeaponOrArmor(itemName, chName);
};

export const setBattlePaused = (isPaused: string) => {
  SC.setBattlePaused(isPaused);
};

export const setAiState = (
  chName: string,
  aiStateKey: string,
  value: string | boolean
) => {
  SC.setAiState(chName, aiStateKey, value);
};

const startQuest = (questName: string) => {
  const result = SC.startQuest(questName);
  if (result) {
    getSceneForCommands().skip = false;
    // SC.setConversation(getCurrentPlayer().leader.name, 0);
    startConversation(`${getCurrentPlayer().leader.name.toLowerCase()}`, true);
    return result;
  }
  return result;
};

const startQuestQuiet = (questName: string) => {
  SC.startQuestQuiet(questName);
};

const completeQuestStep = (questName: string, stepInd: number) => {
  const result = SC.completeQuestStep(questName, stepInd);
  if (result) {
    getSceneForCommands().skip = false;
    // return SC.setConversation(getCurrentPlayer().leader.name, 0);
    // startConversation(`${getCurrentPlayer().leader.name.toLowerCase()}`, true);
    return result;
  }
  return result;
};
const completeQuestSubStep = (
  questName: string,
  stepInd: number,
  subStepInd: number
) => {
  const result = SC.completeQuestSubStep(questName, stepInd, subStepInd);
  return result;
};

const showNotification = (
  text: string,
  type?: 'info' | 'success' | 'warning' | 'danger'
) => {
  return SC.showNotification(text, type);
};

const modifyPartyHP = (v: number) => {
  return SC.modifyPartyHP(v);
};

const modifyPartyRESV = (v: number) => {
  return SC.modifyPartyRESV(v);
};

const disableAnimationSounds = () => {
  return SC.disableAnimationSounds();
};

const enableAnimationSounds = () => {
  return SC.enableAnimationSounds();
};

const changePropAnim = (...args) => {
  return SC.changePropAnim.apply(null, args);
};
const changeTileAnim = (...args) => {
  return SC.changeTileAnim.apply(null, args);
};

const createPropAtMarker = (...args) => {
  return SC.createPropAtMarker.apply(null, args);
};
const createPropAtCharacter = (...args) => {
  return SC.createPropAtCharacter.apply(null, args);
};
const removeProp = (...args) => {
  return SC.removeProp.apply(null, args);
};
const movePropToOffset = (...args) => {
  return SC.movePropToOffset.apply(null, args);
};

const showStore = (storeName: string) => {
  return SC.showStore(storeName);
};

const setPlayerVisibility = (visible: boolean) => {
  return SC.setPlayerVisibility(visible);
};

const setCharacterSpriteBase = (chName: string, spriteBase: string) => {
  return SC.setCharacterSpriteBase(chName, spriteBase);
};

const resetCharacterSpriteBase = (chName: string, chTemplateName?: string) => {
  return SC.resetCharacterSpriteBase(chName, chTemplateName);
};

const setFlashbackMode = (on: boolean) => {
  return SC.setFlashbackMode(on);
};

const addOverlay = (imageName: string, blendMethod: string) => {
  return SC.addOverlay(imageName, blendMethod);
};

const removeOverlay = (imageName: string, blendMethod: string) => {
  return SC.removeOverlay(imageName, blendMethod);
};

const removeOverlays = () => {
  return SC.removeOverlays();
};

const characterSetTalkTrigger = (chName: string, talkTriggerName: string) => {
  return SC.characterSetTalkTrigger(chName, talkTriggerName);
};

const characterSetSortOffset = (chName: string, offset: number) => {
  return SC.characterSetSortOffset(chName, offset);
};

const stopSkipCutscene = () => {
  return SC.stopSkipCutscene();
};

const setRandomInt = (key: string, min: number, max: number) => {
  return SC.setRandomInt(key, min, max);
};

const stashOverworld = () => {
  return SC.stashOverworld();
};

const unstashOverworld = () => {
  return SC.unstashOverworld();
};

const dropHeldProps = (
  markerName?: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();

  const marker = room.markers[markerName ?? ''];

  if (markerName && !marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }

  const target = [
    marker?.x + (xOffset ?? 0) + 8,
    marker?.y + (yOffset ?? 0) + 8,
  ] as Point;

  return dropCurrentlyHeldProps(
    getCurrentPlayer(),
    markerName ? target : undefined,
    false
  );
};

const removeTriggerNotifierAtMarker = (
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  return SC.removeTriggerNotifierAtMarker(markerName, xOffset, yOffset);
};

const setWallCollisionEnabled = (v: boolean) => {
  return SC.setWallCollisionEnabled(v);
};

const setPartyWalkBehindLeaderEnabled = (v: boolean) => {
  return SC.setPartyWalkBehindLeaderEnabled(v);
};

const addMarkersToTiles = (
  tileSprite: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  return SC.addMarkersToTiles(tileSprite, markerName, xOffset, yOffset);
};

const onChWalkCompleted = (
  chName: string,
  scriptSrc: string,
  ...rpgscriptArgs: any[]
) => {
  return SC.onChWalkCompleted(chName, scriptSrc, ...rpgscriptArgs);
};

export const swapTileLayerTileAtMarker = (
  layerPrefix: TileLayerPrefix,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  return SC.swapTileLayerTileAtMarker(
    layerPrefix,
    markerName,
    xOffset,
    yOffset
  );
};

export const setRoomTileLayer = (layer: TileLayerPrefix) => {
  SC.setRoomTileLayer(layer);
};

const lockCamera = (s?: boolean) => {
  return SC.lockCamera(s);
};

const unlockCamera = () => {
  return SC.unlockCamera();
};

// CUSTOM --------------------------------------------------------------------------------

const forceSetUpdateKeysEnabled = () => {
  return SC.forceSetUpdateKeysEnabled();
};

export const floor1TutToggleColorDoorsWalkToOffset = () => {
  // noop
};

// Used in the tutorial room to toggle open/closed all doors with the color of the marker
export const floor1TutToggleColorDoors = (
  color: string,
  shouldChangeState: string,
  isOnLoad: boolean
) => {
  return SC.floor1TutToggleColorDoors(color, shouldChangeState, isOnLoad);
};

const changeLeader = (chName: string) => {
  return SC.changeLeader(chName);
};

const battleV2ChangeStatusEffectValue = (
  chName: string,
  statusEffectName: string,
  value: number
) => {
  return SC.battleV2ChangeStatusEffectValue(chName, statusEffectName, value);
};

const battleV2RestoreAnimationState = (chName: string) => {
  return SC.battleV2RestoreAnimationState(chName);
};

const commands = {
  log,
  assert,
  sbreak,
  loop,
  loopExpr,
  playDialogue,
  setConversation,
  setConversation2,
  setConversationWithoutBars,
  setConversationGroup,
  replaceConversationMember2,
  setUnskippableConversation,
  setUnskippable,
  endConversation,
  resumeGame,
  setConversationSpeaker,
  none,
  setFromDialog,
  waitMS,
  waitMSPreemptible,
  waitUntil,
  waitForUserInput,
  setStorage,
  setStorageValueAt,
  setStorageCond,
  setStorageEval,
  incrementStorage,
  setStorageIfNotSet,
  callScript,
  lookAtCharacter,
  partyLookAtCharacter,
  lookAtMarker,
  partyLookAtMarker,
  lookAtEachOther,
  lookAtCenterOfTrigger,
  setFacing,
  partySetFacing,
  shakeScreen,
  setCharacterAt,
  offsetCharacter,
  walkToMarker,
  walkToPoint,
  walkToCharacter,
  setAtMarker,
  setAtPoint,
  walkToOffset,
  walkPartyToFormation,
  setCharacterAtMarker,
  setCharacterAtCharacter,
  changeTileAtMarker,
  removeWallAtMarker,
  addOrReplaceTileAtMarkerEx,
  addOrReplaceTileAtPositionEx,
  changeTileAtPosition,
  removeWallAtTilePosition,
  spawnCharacterAtCharacter,
  spawnCharacterAtMarker,
  spawnPartyMembersInFormation,
  setPartyAtFormation,
  spawnPartyMembers,
  despawnPartyMembers,
  despawnCharacter,
  fadeOut,
  fadeIn,
  fadeOutColor,
  fadeInColor,
  changeRoom,
  acquireItem,
  acquireQuestItem,
  removeItem,
  modifyTokens,
  modifyTickets,
  jump,
  applyZTransform,
  applyZTransformTileAtMarker,
  applyZTransformTileAtMarkerEx,
  runArcadeCabinetGame,
  hideCurrentArcadeGame,
  setAnimationAndWait,
  setAnimation,
  setAnimationState,
  setSpeed,
  resetAi,
  stopAi,
  startAi,
  setDoorStateAtMarker,
  awaitChoice,
  awaitChoiceEx,
  enterCombat,
  addPartyMemberToActiveParty,
  removePartyMemberFromActiveParty,
  panCameraRelativeToPlayer,
  panCameraRelativeToCurrentPosition,
  panCameraBackToPlayer,
  panCameraToMarker,
  panCameraToFitCharacters,
  panCameraBattle,
  playSound,
  playMusic,
  stopMusic,
  spawnParticleEx,
  spawnParticleAtCharacter,
  spawnEmotionParticleAtCharacter,
  spawnParticleAtMarker,
  setCharacterText,
  showUISection,
  setBattlePaused,
  equipWeaponOrArmor,
  pauseOverworld,
  unpauseOverworld,
  setAiState,
  startQuest,
  startQuestQuiet,
  showStore,
  completeQuestStep,
  completeQuestSubStep,
  showNotification,
  modifyPartyHP,
  modifyPartyRESV,
  disableAnimationSounds,
  enableAnimationSounds,
  changePropAnim,
  changeTileAnim,
  createPropAtMarker,
  createPropAtCharacter,
  removeProp,
  movePropToOffset,
  setPlayerVisibility,
  setCharacterSpriteBase,
  resetCharacterSpriteBase,
  setFlashbackMode,
  addOverlay,
  removeOverlay,
  removeOverlays,
  characterSetTalkTrigger,
  characterSetSortOffset,
  stopSkipCutscene,
  setRandomInt,
  stashOverworld,
  unstashOverworld,
  dropHeldProps,
  removeTriggerNotifierAtMarker,
  setWallCollisionEnabled,
  setPartyWalkBehindLeaderEnabled,
  addMarkersToTiles,
  onChWalkCompleted,
  swapTileLayerTileAtMarker,
  setRoomTileLayer,
  lockCamera,
  unlockCamera,

  // custom scripts
  forceSetUpdateKeysEnabled,
  floor1TutToggleColorDoorsWalkToOffset,
  floor1TutToggleColorDoors,
  changeLeader,
  battleV2ChangeStatusEffectValue,
  battleV2RestoreAnimationState,
};

export default commands;
