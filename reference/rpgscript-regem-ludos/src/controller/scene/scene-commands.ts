import { getUiInterface, renderUi } from 'view/ui';
import {
  setCutsceneText,
  showSection,
  startConversation2,
  startConversation,
  hideConversation,
  showConversation,
  showArcadeGame,
  showChoices,
  setCharacterText as setCharacterTextUi,
  showModal,
  showSave,
  showLevelUp,
  showNotification as showNotificationUi,
  showQuestSection,
  hideQuestSection,
  hideSection,
  showStoreSection,
  hideStoreSection,
  showInfoStatsSection,
  hideInfoStatsSection,
  showIntroSection,
  showCharacterStatus,
  showSellSection,
  hideSellSection,
  setConversationActors,
  hideConversation2Member,
  hideArcadeGame,
} from 'controller/ui-actions';
import { AppSection, CutsceneSpeaker, ModalSection } from 'model/store';
import { isConfirmKey, popKeyHandler, pushKeyHandler } from 'controller/events';
import {
  characterCreateFromTemplate,
  characterGetPosCenterPx,
  characterSetFacing,
  characterSetFacingFromAngle,
  characterSetPos,
  characterSetWalkTarget,
  characterGetPos,
  characterSetTransform,
  characterOverrideAnimation,
  characterSetAnimationState,
  characterStartAi,
  characterStopAi,
  characterModifyHp,
  characterStopWalking,
  characterHasPortrait,
  characterSetSpeed,
  characterModifyResv,
  characterHasWalkTarget,
  characterGetTilePos,
  characterUnEquipItemV2,
  characterEquipItemV2,
} from 'model/character';
import { Facing, AnimationState, Character } from 'model/character-type';
import {
  getAllTagMarkers,
  IRoomAddTileArgs,
  Marker,
  roomAddCharacter,
  roomAddParticle,
  roomAddProp,
  roomAddTile,
  roomGetCharacterByName,
  roomGetCoordsBelow,
  roomGetCurrentTileLayer,
  roomGetDirectionOfNearestTileInList,
  roomGetNearestTileInList,
  roomGetProp,
  roomGetProps,
  roomGetTileAt,
  roomGetTileBelow,
  roomGetTileLayer,
  roomGetTileLayerPrefixForCharacter,
  roomGetTileLayerPrefixForMarker,
  roomGetTileLayerPrefixForZ,
  roomRemoveCharacter,
  roomRemoveProp,
  roomSetCurrentTileLayer,
  roomSetTileAt,
  SPRITE_CONTROL_EXCLAIM,
  SPRITE_CONTROL_EXCLAIM_INVISIBLE,
  Tile,
  TILE_HEIGHT_WORLD,
  TILE_WIDTH_WORLD,
  tileGetPosition,
  TileLayerPrefix,
} from 'model/room';
import {
  getCurrentRoom,
  getCurrentPlayer,
  getCurrentOverworld,
  setCameraTransform,
  getCameraTransform,
  getCurrentBattle,
  addCharacterWithSuspendedAi,
  getCutsceneSpeedMultiplier,
  setCutsceneSkipEnabled,
  setFlashbackModeOn,
  enableKeyUpdate,
  setCutsceneDisableWalls,
  getCurrentScene,
  setLastCameraTransform,
  getLastCameraTransform,
  setOverworldUpdateKeysDisabled,
} from 'model/generics';
import {
  callScript as sceneCallScript,
  createAndCallScript,
  getSceneForCommands,
  evalCondition,
} from 'controller/scene-management';
import {
  getAngleTowards,
  isoToPixelCoords,
  isTest,
  pixelToIsoCoords,
  Point,
  Point3d,
  timeoutPromise,
  set,
  get,
  getRandBetween,
  timeoutWithPromise,
  undefNaN,
  facingToIncrements,
} from 'utils';
import { Animation, createAnimation, hasAnimation } from 'model/animation';
import {
  initiateOverworld,
  walkPartyToFormationOverworld,
  stashOverworld as overworldStashOverworld,
  unstashOverworld as overworldUnstashOverworld,
  shouldSpawnConscience,
} from 'controller/overworld-management';
import { getIfExists as getTileTemplateIfExists } from '_db/tiles';
import { getIfExists as getCharacterTemplateIfExists } from '_db/characters';
import { getIfExists as getOverworld } from '_db/overworlds';
import { getIfExists as getEncounter } from '_db/encounters';
import { EmotionBubble, getIfExists as getParticle } from '_db/effects';
import { getIfExists as getItem } from '_db/items';
import { getIfExists as getQuest, QuestTemplate } from '_db/quests';
import {
  playerAddItem,
  playerRemoveItem,
  playerModifyTokens,
  playerModifyTickets,
  playerGetCameraOffset,
  playerAddToActiveParty,
  playerRemoveFromActiveParty,
  playerGetPartyMember,
  playerSetWalkBehindLeaderEnabled,
  playerSaveCurrentLeaderState,
  playerSetLeader,
} from 'model/player';
import { Timer, Transform, TransformEase } from 'model/utility';
// import { ArcadeGamePath } from 'view/components/ArcadeCabinet';
import { overworldHide, OverworldOverlay } from 'model/overworld';
import {
  playSoundName,
  stopCurrentMusic,
  playMusic as playMusicName,
  getSound,
} from 'model/sound';
import {
  createCreditsParticle,
  createEmotionBubbleParticle,
  createRiseParticle,
  createWeightedParticle,
  particleCreateFromTemplate,
  ParticleTemplate,
} from 'model/particle';
import {
  sceneAddPostSceneCallback,
  sceneCreate,
  sceneGetStorage,
  sceneHasNotificationsToShow,
  scenePushNotificationToShow,
  sceneReplaceTemplateStrings,
  sceneSetStorage,
  sceneStopWaitingForTime,
  sceneStopWaitingUntil,
} from 'model/scene';
import {
  createMarkerRenderObject,
  createPropRenderObject,
} from 'model/render-object';
import { pause, unpause } from '../loop';
import { getScreenSize } from 'model/canvas';
import {
  beginQuest as beginQuestFromManagement,
  completeQuestStep as completeQuestStepFromManagement,
  completeQuestSubStep as completeQuestSubStepFromManagement,
  questIsCompleted,
} from 'model/quest';
import { getIfExists as getStore } from '_db/stores';
import { getSprite } from 'model/sprite';
import { dropCurrentlyHeldProps } from 'controller/overworld-management/overworld-management-props';
import { ScriptParser } from 'lib/rpgscript';
import { get as getCharacterTemplate } from '_db/characters';
import { battleV2PanCameraToRelativePosition } from 'controller/battleV2-management/battleV2-turn-management';
import { UpdateStatusEffectValue } from 'controller/battleV2-management/activities/UpdateStatusEffectValue';
import { BattleV2AsyncAutomation } from 'model/battleV2/battleV2-async-automation';
import {
  battleV2InvokeEvent,
  battleV2ParticipantAddAutomation,
} from 'model/battleV2/battleV2';
import { BattleV2StatusEffectType } from 'model/battleV2/battleV2-status-effects';
import { battleV2CharacterGetAnimDefs } from 'model/battleV2/battleV2-character';
import { battleV2StartFromOverworld } from 'controller/battleV2-management/battleV2-transition-management';
import { determineSlotForItemTemplate } from 'model/item-v2';
import { BattleV2Event } from 'model/battleV2/battleV2-subscriptions';
import { ArcadeGamePath } from 'view/components/ArcadeCabinet';

const log = (text: string) => {
  const currentScript = getSceneForCommands().currentScript;

  const scriptName = currentScript?.name;
  const fileName = '/' + currentScript?.filename + '.rpgscript';
  // const commandIndex = (currentScript?.currentCommandIndex ?? 0) - 1;
  // const blockIndex = (currentScript?.currentBlockIndex ?? 0) - 1;
  const lineNum = currentScript?.lineNum;
  console.log(
    '[RPGSCRIPT] %c' +
      text +
      ' %c' +
      scriptName +
      ':%c' +
      lineNum +
      ' %cin file %c' +
      fileName,
    'color:#F00',
    'color:#a00',
    'color:#aaa',
    'color:#a00',
    'color:#aaa'
  );
};

const sbreak = () => {
  const scene = getSceneForCommands();
  if (scene.currentScript) {
    scene.breakNextScriptCompletion = true;
    scene.currentScript.breakScript();
  }

  return true;
};

/**
 * Loop a given script n times, setting {vars.loopIndex} to the current loop index.  Supports
 * scripts with arguments.  For example, if you want to specify the loop index as an argument
 * you can write:
 *
 * ```
 * loop(someFunction(\{vars.loopIndex\}), 5);
 * ```
 *
 * This calls `someFunction` 5 times with the arguments `0`, `1`, `2`, `3`, and `4`.
 */
const loop = (
  scriptName: string,
  numTimes: number,
  indOffset?: number | string
) => {
  if (!scriptName.includes('(')) {
    scriptName += '()';
  }

  scriptName = scriptName.replace(/\\{/g, '{').replace(/\\}/g, '}');

  indOffset = Number(indOffset ?? 0);
  let scriptBody = ``;
  for (let i = 0; i < numTimes; i++) {
    scriptBody += `+setStorage(vars.loopIndex, ${i + indOffset});\n`;
    scriptBody += `+setStorage(i, ${i});\n`;
    scriptBody += `+:${scriptName};\n`;
  }
  // sceneCallScript(scene, scriptName, ...args);
  createAndCallScript(getSceneForCommands(), scriptBody);
  return true;
};

const loopExpr = (expr: string, numTimes: number) => {
  let scriptBody = '';
  for (let i = 0; i < numTimes; i++) {
    scriptBody += `+setStorage(vars.loopIndex, ${i});\n`;
    scriptBody += `+setStorage(i, ${i});\n`;
    scriptBody += `${expr
      .replace(/\\n/g, '\n')
      .replace(/\\{/g, '{')
      .replace(/\\}/g, '}')};\n`;
  }
  createAndCallScript(getSceneForCommands(), scriptBody);
  return true;
};

// +assert("+?all(func(inParty, Skye), func(inParty, Anjana))");
const assert = (expression: string, expressionOnFailure?: string) => {
  sceneSetStorage(getSceneForCommands(), 'vars.assertion', false);
  const scriptBody = `
    ${expression}:{
      +setStorage(vars.assertion, true);
    }
  `;
  getSceneForCommands().breakNextScriptCompletion = true;
  createAndCallScript(getSceneForCommands(), scriptBody).then(() => {
    const exprResult = sceneGetStorage(getSceneForCommands(), 'vars.assertion');
    console.log('Assert result script', exprResult, expression);
    if (!exprResult) {
      const scene = getSceneForCommands();
      if (scene.currentScript) {
        scene.currentScript.breakScript();
      }
      if (expressionOnFailure) {
        createAndCallScript(getSceneForCommands(), expressionOnFailure);
      }
    }
  });
  return true;
};

/**
 * Displays dialog in a text box with the given actorName as the one speaking.
 *
 * An optional soundName may be given to play a sound when the text is shown.  This command
 * only works when a `conversation` is active, created by a command like `setConversation`
 * or `setConversation2`.  The text is shown to the user and the program waits for input
 * from the user before proceeding to the next command.
 *
 * This is the command generated in rpgscript when a line is specified with an actor
 * name followed by a colon, then quoted text.
 *
 * ```
 * Conscience: "Whoah. You got a high score!"
 * ```
 *
 * Converts to the command:
 *
 * ```
 * playDialog('Conscience', 'Whoah. You got a high score!');
 * ```
 */
export const playDialogue = (args: {
  actorName: string;
  text: string;
  soundName?: string;
  portraitEmotion?: string;
  dontWaitForInput?: boolean;
}) => {
  // eslint-disable-next-line prefer-const
  let { actorName, text, soundName, portraitEmotion } = args;

  const previousActorName = getUiInterface().appState.cutscene.actorName;
  const isGroup = getUiInterface().appState.cutscene.actors.length > 1;

  if (previousActorName !== actorName.toLowerCase()) {
    if (isGroup) {
      panCameraToFitCharacters(250, true, actorName);
    }
  }

  const cb = () => {
    if (!getSceneForCommands().isWaitingForInput && !args.dontWaitForInput) {
      waitForUserInputDialog();
    }
  };

  const playDialogInner = () => {
    const { cutscene } = getUiInterface().appState;
    if (!cutscene.visible) {
      console.error(
        'Tried to play dialog while cutscene was not visible',
        actorName,
        text
      );
      return;
    }

    let speaker = CutsceneSpeaker.None;
    const actorNameLower = actorName.toLowerCase();
    if (cutscene.portraitLeft === actorNameLower) {
      speaker = CutsceneSpeaker.Left;
    } else if (cutscene.portraitLeft2 === actorNameLower) {
      speaker = CutsceneSpeaker.Left2;
    } else if (cutscene.portraitRight === actorNameLower) {
      speaker = CutsceneSpeaker.Right;
    } else if (cutscene.portraitRight2 === actorNameLower) {
      speaker = CutsceneSpeaker.Right2;
    } else if (cutscene.portraitCenter === actorNameLower) {
      speaker = CutsceneSpeaker.Center;
    }

    let nameLabel = actorName;

    if (ch) {
      nameLabel = ch.nameAlt[actorName] ?? ch.nameLabel;
    }
    if (
      speaker !== cutscene.speaker &&
      [CutsceneSpeaker.Left, CutsceneSpeaker.Right].includes(speaker)
    ) {
      playSoundName('dialog_woosh');
    }

    text = String(sceneReplaceTemplateStrings(getSceneForCommands(), text));

    setCutsceneText({
      text,
      speaker,
      actorNameLabel:
        actorNameLower !== 'narrator' && actorNameLower !== 'log'
          ? nameLabel
          : '',
      actorName,
      portraitEmotion,
    });

    if ((window as any).TEST) {
      cb();
      return true;
    }

    if (args.dontWaitForInput) {
      cb();
      return true;
    }

    // console.log('Should reset', previousActorName, actorName);
    // if (previousActorName !== actorName.toLowerCase()) {
    //   console.log('yes reset');
    // }

    return waitMS(50, cb);
  };

  const { cutscene } = getUiInterface().appState;
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, actorName);

  // if the dialog box should have a portrait but no portrait is showing.
  if (
    ch &&
    !cutscene.portraitRight &&
    !cutscene.portraitLeft &&
    // cutscene.actorName &&
    cutscene.actorName.toLowerCase() !== ch.name.toLowerCase()
  ) {
    console.log(
      'SET CONVERSATION',
      ch.name,
      cutscene.actorName.toLowerCase() !== ch.name.toLowerCase()
    );
    if (characterHasPortrait(ch)) {
      setConversation(ch.name, 0);
    }
    if (isTest()) {
      playDialogInner();
      return true;
    } else {
      setTimeout(() => {
        playDialogInner();
      }, 50);
    }
    // createAndCallScript(getSceneForCommands(), `${actorName}: ${text}`);
    // setTimeout(
    return waitMS(50, cb);
  } else {
    return playDialogInner();
  }
};

/**
 * Starts a cutscene where the two provided actor names' portraits are displayed on the
 * left and the right respectively.
 *
 * NOTE: The given names must have a portrait animation specified for them.
 * For example "Ada" has an animation specified "ada_portrait" in
 * the "res.txt" file:
 *
 * ```
 * Picture,ada512,ada512.png,512,512
 * Animation,ada_portrait,true
 * ```
 *
 * If a conversation is not already happening, this pops up the cutscene bars on top and
 * bottom, and also slides the character portraits up from the bottom.
 *
 * Example test case:
 * ```
 * @test-setConversation2
 * +setConversation2('Ada', 'Conscience');
 * Ada: "This script tests `setConversation2`."
 * Ada: "Conscience and I should be speaking now."
 * Conscience: "Well... not at the same time, but you should see both of us at least."
 * Ada: "The conversation will now end, then start again."
 * +endConversation();
 * +setConversation2('Conscience', 'Ada');
 * Conscience: "Tadaa!  We're back!"
 * Ada: "And it appears we have switched places."
 * Conscience: "Weird."
 * Conscience: "The test will now conclude."
 * +endConversation();
 * ```
 *
 * ![Example Image](../res/docs/setConversation2Example.png)
 */
export const setConversation2 = (
  actorNameLeft: string,
  actorNameRight: string,
  ms?: number
) => {
  // if (!actorNameLeft) {
  //   console.error('No left actor specified.');
  //   return;
  // }
  // if (!actorNameRight) {
  //   console.error('No right actor specified.');
  //   return;
  // }

  const appState = getUiInterface().appState;
  if (appState.cutscene.visible) {
    showConversation();
  } else if (
    !appState.cutscene.portraitLeft &&
    !appState.cutscene.portraitRight
  ) {
    endConversation(0, true);
  }

  playSoundName('dialog_woosh');

  startConversation2(
    `${actorNameLeft.toLowerCase()}`,
    `${actorNameRight.toLowerCase()}`
  );
  if (ms === 0) {
    return;
  }

  return waitMS(ms ?? 100);
};

/**
 * Starts a cutscene where the provided actor name's portrait is displayed on the left
 * and their text box is displayed on the right.
 *
 * NOTE: The given names must have a portrait animation specified for it.
 * For example "Ada" has an animation specified "ada_portrait" in the "res.txt" file:
 *
 * ```
 * Picture,ada512,ada512.png,512,512
 * Animation,ada_portrait,true
 * ```
 *
 * If a conversation is not already happening, this pops up the cutscene bars on top and
 * bottom, and also slides the character portrait up from the bottom-left.
 *
 * Example test case:
 * ```
 * @test-setConversation
 * +setConversation('Ada');
 * Ada: "This script tests `setConversation`."
 * Ada: "Only one person should be speaking now."
 * Ada: "The conversation will now end, then start again."
 * +endConversation();
 * +setConversation('Conscience');
 * Conscience: "Tadaa!  It's me now!"
 * Conscience: "The test will now conclude."
 * +endConversation();
 * ```
 *
 *![Example Image](../res/docs/setConversation1Example.png)
 *
 *
 */
export const setConversation = (
  actorName = 'ada',
  ms?: number,
  callback?: () => void
) => {
  if (
    actorName === 'undefined' ||
    actorName === undefined ||
    actorName === null
  ) {
    actorName = 'ada';
  }
  const appState = getUiInterface().appState;
  const player = getCurrentPlayer();
  characterStopWalking(player.leader);
  if (appState.cutscene.visible) {
    // HACK.  Sometimes setConversation is called multiple times in a row and messes up
    // the cutscene rendering.  This short circuits that problem
    if (appState.cutscene.portraitCenter === actorName.toLowerCase()) {
      if (callback) {
        callback();
      }
      return;
    }
    setCutsceneText({ text: '' });
    setConversationSpeaker(CutsceneSpeaker.None);
    const cb = () => {
      startConversation(`${actorName.toLowerCase()}`, true);
      playSoundName('dialog_woosh');
      if (callback) {
        return callback();
      }
    };
    if (ms === 0) {
      return cb();
    }
    return waitMS(200, cb);
  } else {
    startConversation(`${actorName.toLowerCase()}`, true);
    playSoundName('dialog_woosh');
    if (ms === 0) {
      if (callback) {
        return callback();
      }
      return undefined;
    }
    return waitMS(ms ?? 25, () => {
      if (callback) {
        callback();
      }
    });
  }
};

export const setConversationWithoutBars = (actorName: string, ms?: number) => {
  startConversation(`${(actorName || 'Ada').toLowerCase()}`, false);
  playSoundName('dialog_woosh');
  if (ms === 0) {
    return undefined;
  }
  return waitMS(100);
};

export const setUnskippableConversation = (actorName: string, ms?: number) => {
  setCutsceneSkipEnabled(false);
  startConversation(`${(actorName || 'Ada').toLowerCase()}`, true);
  if (ms === 0) {
    return undefined;
  }
  return waitMS(100);
};

export const setConversationGroup = (ms?: number, ...actorNames: string[]) => {
  const num = Number(ms);
  if (isNaN(num) || (ms as any) === '') {
    actorNames.unshift(ms as unknown as string);
    ms = undefined;
  }
  const room = getCurrentRoom();
  return setConversation(actorNames[0], ms ?? 0, () => {
    setConversationActors(
      actorNames
        .map(name => roomGetCharacterByName(room, name))
        .filter(ch => Boolean(ch)) as Character[]
    );
  });
};

export const replaceConversationMember2 = (
  actorName: string,
  side: 'left' | 'right'
) => {
  setCutsceneText({ text: '' });
  hideConversation2Member(side);
  setTimeout(() => {
    if (side === 'left') {
      setConversation2(
        actorName.toLowerCase(),
        getUiInterface().appState.cutscene.portraitRight,
        300
      );
    } else if (side === 'right') {
      setConversation2(
        getUiInterface().appState.cutscene.portraitLeft,
        actorName.toLowerCase(),
        300
      );
    }
    setTimeout(() => {
      const scene = getSceneForCommands();
      scene.isWaitingForInput = false;
    }, 300);
  }, 100);
  return waitUntil();
};

export const setUnskippable = (v: boolean) => {
  setCutsceneSkipEnabled(!v);
};

/**
 * Removes all portraits and cutscene bars from the screen.  Portraits slide downwards,
 * and cutscene bars slide off.  After an optionally specified number of milliseconds,
 * this function resumes executing the script. This number defaults to 0.5 seconds
 * if not provided.  For step triggers, endConversation needs to know if it should
 * hide the cutscene section, otherwise it will stay on due to the nature of a step
 * trigger.
 */
export const endConversation = (ms?: number, dontHideCutscene?: boolean) => {
  setCutsceneText({ text: '' });
  hideConversation();
  getCurrentPlayer().tilesVisited = [];
  const cb = () => {
    if (
      (dontHideCutscene === undefined || dontHideCutscene === false) &&
      !getCurrentBattle() &&
      // without this check, the app state hides the arcade cabinet when tokens are awarded
      !getUiInterface().appState.sections.includes(AppSection.ArcadeCabinet)
    ) {
      showSection(AppSection.Debug, true);
    }
    setCutsceneSkipEnabled(true);
  };
  if (ms === 0) {
    return cb();
  }

  return waitMS(ms ?? 200, cb);
};

export const resumeGame = () => {
  unpause();
  setOverworldUpdateKeysDisabled(false);
  showSection(AppSection.Debug, true);
};

/**
 * This sets which portrait is rendered as "active".  During a conversation2,
 * this moves the portrait on the left to the forefront and with 100% opacity
 * pushing all other portraits away, and setting their opacity to be semi-transparent.
 *
 * Values for the speaker can be one of the following:
 *
 * ```
 * "left"
 * "left2"
 * "right"
 * "right2"
 * "center"
 * "none"
 * ```
 *
 * setConversationSpeaker is implicitly called when specifying a character who is
 * speaking, with the normal syntax (`Conscience: "We should help her!"`)
 *
 * ![Example Image](../res/docs/setSpeakerLeftExample.png)
 *
 * Direct calling of this function is mostly useful for moving the portraits around
 * a little more manually than the automatic way.
 *
 * The following code contains a line with `Other:` which implicitly has a `setConversationSpeaker`
 * call to 'none'.  This pushes every other portrait to the side, setting their opacity to
 * be semi-transparent and simulating a situation where neither character in a conversation2
 * is speaking; somebody else is.
 *
 * ```
 * @test-setConversationSpeaker
 * +setConversation2('Ada', 'Conscience');
 * Ada: "This script tests `setConversationSpeaker`."
 * Conscience: "We are both speaking now, but after this dialog, a spooky disembodied voice will say something!"
 * // Note: specifying any label that isn't part of the conversation implicitly calls setConversationSpeaker('none')
 * // In this case "Other" is not in the conversation
 * Other: "WELL. WELL. WELL.  WHAT DO WE HAVE HERE?"
 * // Note: calling setConversationSpeaker directly will remove the dialog box.
 * +setConversationSpeaker('none');
 * +waitMS(1500);
 * +setConversationSpeaker('left');
 * +waitMS(1000);
 * Ada: "Who was that?"
 * Conscience: "I don't know!  Is this part of the test?"
 * Ada: "Perhaps we should... abort the sequence.  Now!"
 * Conscience: "The test w-w-w-ill now conclude!!"
 * +endConversation();
 * ```
 *
 * ![Example Image](../res/docs/setSpeakerExample.png)
 */
export const setConversationSpeaker = (speaker: CutsceneSpeaker) => {
  const uiState = getUiInterface().appState;

  // Hack.  'none' actor name is only loosely enforced.  It's more of a guideline
  // than a hard name that indicates nobody is speaking.
  if (!uiState.cutscene.visible) {
    return;
  }

  if (uiState.sections.includes(AppSection.Cutscene)) {
    setCutsceneText({ text: '', speaker });
  }
};

export const none = () => {
  setConversationSpeaker(CutsceneSpeaker.None);
};

/**
 * Some dialog is called from trigger activators instead of dialog.  Dialog triggers
 * act slightly differently than from a trigger activator.  For example, when a dialog trigger
 * happens, a character's ai state is saved.  When the cutscene is over, the ai state is restored.
 * This function is to be called to indicate that a certain character should be treated
 * as if the current cutscene was called from a dialog trigger.
 */
export const setFromDialog = (chName: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  stopAi(chName);
  addCharacterWithSuspendedAi(ch);
};

/**
 * Waits for the specified number of milliseconds, ignoring all user input until that time.
 *
 * The `cb` argument is not to be used in rpgscript, and only for internal use.
 * The `isAbsolute` argument is used to tell the interpreter that this should not be affected
 *   by the cutscene speed multiplier
 */
export const waitMS = (ms: number, cb?: () => void, isAbsolute?: boolean) => {
  const scene = getSceneForCommands();
  scene.isWaitingForTime = true;
  clearTimeout(scene.waitTimeoutId);
  const prevCb = scene.waitTimeoutCb;
  scene.waitTimeoutCb = () => {
    if (prevCb) {
      prevCb();
    }

    scene.isWaitingForTime = false;
    if (cb) {
      cb();
    }
    scene.waitTimeoutCb = null;
    scene.waitTimeoutTimer = undefined;
  };
  scene.waitTimeoutId = 1;
  const { timer, promise } = timeoutWithPromise(
    ms * (isAbsolute ? 1 : 1 / getCutsceneSpeedMultiplier())
  );
  scene.waitTimeoutTimer = timer;
  promise.then(() => {
    if (scene.waitTimeoutCb) {
      scene.waitTimeoutCb();
    }
  }) as any;
  return true;
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
  const scene = getSceneForCommands();
  const keyHandler = (ev: KeyboardEvent) => {
    switch (isConfirmKey(ev.key) || ev.key === ' ' || ev.key === 'Enter') {
      case true: {
        clearTimeout(scene.waitTimeoutId);
        popKeyHandler(keyHandler);
        _cb();
        break;
      }
    }
  };
  pushKeyHandler(keyHandler);
  const _cb = () => {
    scene.isWaitingForTime = false;
    if (cb) {
      cb();
    }
    popKeyHandler(keyHandler);
  };
  scene.isWaitingForTime = true;
  clearTimeout(scene.waitTimeoutId);
  scene.waitTimeoutId = setTimeout(
    _cb,
    ms * (1 / getCutsceneSpeedMultiplier())
  ) as any;
  return true;
};

/**
 * (Internal use only.)
 */
const waitUntil = () => {
  const scene = getSceneForCommands();
  scene.isWaitingForTime = true;
  return () => {
    console.log('DONE WAITING UNTIL REPLACE');
    sceneStopWaitingForTime(scene);
  };
};

/**
 * (Internal use only.)
 */
const waitForUserInput = (cb?: () => void) => {
  const scene = getSceneForCommands();
  if (scene.isWaitingForInput) {
    console.error('Scene is already waiting for input!');
    return;
  }

  scene.isWaitingForInput = true;
  let inputDisabled = false;

  const keyHandler = (ev: KeyboardEvent) => {
    const scene = getSceneForCommands();
    if (scene.inputDisabled || inputDisabled) {
      return;
    }

    switch (isConfirmKey(ev.key) || ev.key === ' ' || ev.key === 'Enter') {
      case true: {
        inputDisabled = true;
        clearTimeout(scene.waitTimeoutId);
        _cb();
        return true;
      }
    }

    return false;
  };

  pushKeyHandler(keyHandler);
  const _cb = () => {
    scene.isWaitingForInput = false;
    popKeyHandler(keyHandler);
    if (cb) {
      cb();
    }
  };

  return _cb;
};

/**
 * (Internal use only.)
 */
const waitForUserInputDialog = (cb?: () => void) => {
  const scene = getSceneForCommands();
  if (scene.isWaitingForInput) {
    console.error('Scene is already waiting for input in a dialog!');
    return;
  }

  scene.isWaitingForInput = true;

  let inputDisabled = false;

  const keyHandler = (ev: KeyboardEvent) => {
    const scene = getSceneForCommands();
    if (scene.inputDisabled || inputDisabled) {
      return;
    }

    switch (isConfirmKey(ev.key) || ev.key === ' ' || ev.key === 'Enter') {
      case true: {
        inputDisabled = true;
        playSoundName('dialog_select');
        if ((window as any).TEST) {
          clearTimeout(scene.waitTimeoutId);
          _cb();
        } else {
          setTimeout(() => {
            clearTimeout(scene.waitTimeoutId);
            _cb();
          }, 100);
        }
        break;
      }
    }
  };
  pushKeyHandler(keyHandler);
  const _cb = () => {
    scene.isWaitingForInput = false;
    popKeyHandler(keyHandler);
    if (cb) {
      cb();
    }
  };

  return _cb;
};

/**
 * Sets a key/value pair on a player's save file.  Useful setting variables.
 */
export const setStorage = (
  key: string,
  value: string | boolean | number,
  isOnceKey?: boolean
) => {
  if (value === 'false') {
    value = false;
  }
  if (value === 'true') {
    value = true;
  }
  if (typeof value === 'string') {
    if (value.slice(0, 5) === 'rand(') {
      const [min, max] = value
        .slice(5, value.length - 1)
        .split(',')
        .map(Number);
      value = getRandBetween(min, max);
    }
  }
  // console.log(`Set Storage isOnce: ${Boolean(isOnceKey)}`, key, value ?? true);
  const scene = getSceneForCommands();
  if (isOnceKey) {
    scene.storageOnceKeys[key] = Boolean(value);
  } else {
    if (typeof value === 'string' && value !== '' && !isNaN(Number(value))) {
      value = Number(value);
    }
    set(scene.storage, key, value ?? true);
  }
};

export const setStorageValueAt = (key: string, value: string) => {
  const scene = getSceneForCommands();
  setStorage(key, get(scene.storage, value) ?? false);
};

export const setStorageCond = (key: string, expr: string) => {
  const scene = getSceneForCommands();
  const parser = new ScriptParser('Conditional');
  try {
    const c = parser.parseConditional(expr, -1);
    setStorage(key, evalCondition(scene, c));
  } catch (e) {
    console.error(
      'Failed to parse conditional in setStorageCond',
      expr,
      e.stack
    );
  }
};

export const setStorageEval = (key: string, expr: string) => {
  try {
    const result = eval(expr);
    console.log('Eval result', result, 'expr', expr);
    setStorage(key, result);
  } catch (e) {
    console.error('Failed to eval expression', expr, e.stack);
  }
};

/**
 * Modify a number in storage by an incremental value.  Can be negative.
 */
export const incrementStorage = (key: string, incValue: number) => {
  if (isNaN(Number(incValue))) {
    console.error(
      'cannot increment storage for',
      key,
      'incValue is not a number:',
      incValue
    );
  }

  let val = get(getSceneForCommands().storage, key) ?? 0;
  if (typeof val === 'string') {
    val = Number(val);
  }

  setStorage(key, val + incValue);
};

export const setStorageIfNotSet = (
  key: string,
  value: string | boolean | number
) => {
  const scene = getSceneForCommands();
  if (get(scene.storage, key) === undefined) {
    setStorage(key, value);
  }
};

/**
 * Call another script.  This line waits for the script to return before invoking
 * the next line.
 *
 * ```
 * @test-callScript
 * +setConversation('Conscience');
 * Conscience: "This script tests `callScript`."
 * Conscience: "After this dialog, a call will be made to another script where Ada will pop in, then I shall return!"
 * +endConversation();
 * +callScript('test-callScript2');
 * +setConversation('Conscience');
 * Conscience: "Hey again!"
 * Conscience: "The test will now conclude."
 * +endConversation();
 *
 * @test-callScript2
 * +setConversation('Ada');
 * Ada: "Okay, I am here now."
 * Ada: "I suppose that means the test is working."
 * Ada: "You may now see Conscience again."
 * +endConversation();
 * ```
 *
 */
export const callScript = (scriptName: string, ...args: any[]) => {
  const scene = getSceneForCommands();
  sceneCallScript(scene, scriptName, ...args);
  return true;
};

/**
 * Sets the given character to be facing another character.  Both characters must be
 * present in the room for this to work.
 */
export const lookAtCharacter = (chName: string, targetChName: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const ch2 = roomGetCharacterByName(room, targetChName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        lookAtCharacter(ch.name, targetChName);
      }
    });
    return;
  }

  // if (targetChName.toLowerCase() === 'party') {
  //   targetChName = getCurrentPlayer().leader.name;
  // }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (!ch2) {
    console.error(
      'Could not find target character to lookAtCharacter with name: ' +
        targetChName
    );
    return;
  }

  if (ch && ch2) {
    const point1 = characterGetPosCenterPx(ch);
    const point2 = characterGetPosCenterPx(ch2);
    const angle = getAngleTowards(point1, point2);
    characterSetFacingFromAngle(ch, angle);
  }
};

export const partyLookAtCharacter = (targetChName: string) => {
  const player = getCurrentPlayer();
  player.party.forEach(ch => {
    lookAtCharacter(ch.name, targetChName);
  });
};

/**
 * Sets the given character to be facing a marker.  Both the character and marker
 * must be present in the room for this to work.
 */
export const lookAtMarker = (chName: string, markerName: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const marker = room.markers[markerName];

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        lookAtMarker(ch.name, markerName);
      }
    });
    return;
  }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }

  if (ch && marker) {
    const point1 = characterGetPosCenterPx(ch);

    // HACK I hate my coordinate system so much
    const [px, py] = isoToPixelCoords(marker.x, marker.y);
    const [w, h] = [32, 32];
    const point2 = [px + w / 2, py + h / 2] as Point;
    point2[1] += 4;

    const angle = getAngleTowards(point1, point2);
    characterSetFacingFromAngle(ch, angle);
  }
};

export const partyLookAtMarker = (markerName: string) => {
  const player = getCurrentPlayer();
  player.party.forEach(ch => {
    lookAtMarker(ch.name, markerName);
  });
};

/**
 * A shortcut command for double `lookAtCharacter` calls.
 *
 * This command:
 *
 * ```
 * lookAtEachOther("Ada", "Conscience");
 * ```
 *
 * Is the same as:
 *
 * ```
 * +lookAtCharacter("Ada", "Conscience");
 * +lookAtCharacter("Conscience", "Ada");
 * ```
 */
export const lookAtEachOther = (chName1: string, chName2: string) => {
  lookAtCharacter(chName1, chName2);
  lookAtCharacter(chName2, chName1);
};

export const lookAtCenterOfTrigger = (chName: string) => {
  const scene = getSceneForCommands();
  const ta = scene.currentTriggerActivator;
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  lookAtMarker(chName, 'MarkerPlayer');
  if (ta && ch) {
    const point1 = characterGetPosCenterPx(ch);

    // HACK I hate my coordinate system so much.
    // Convert trigger activator center point to a marker, then use logic to look
    // at a marker (which works, for some reason)
    const x = ta.x + ta.width / 2;
    const y = ta.y + ta.height / 2;
    const [xPx, yPy] = isoToPixelCoords(x, y);
    const [newX, newY] = pixelToIsoCoords(xPx, yPy - 16);
    const [px, py] = isoToPixelCoords(newX, newY);
    const [w, h] = [32, 32];
    const point2 = [px + w / 2, py + h / 2] as Point;
    point2[1] += 4;

    const angle = getAngleTowards(point1, point2);
    characterSetFacingFromAngle(ch, angle);
  }
};

/**
 * Sets the given character to be facing a direction.  The direction can be one of:
 *
 * ```
 * "up"
 * "down"
 * "left"
 * "right" (left_f)
 * "leftup"
 * "leftdown"
 * "rightup" (leftup_f)
 * "rightdown" (leftdown_f)
 * ```
 *
 * The character name provided must be defined in the character database and in the current
 * room.
 *
 * ```
 * // set facing for "Ada" to be up and left
 * +setFacing("Ada", "leftup");
 * ```
 */
export const setFacing = (chName: string, facing: Facing) => {
  const room = getCurrentRoom();
  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        setFacing(ch.name, facing);
      }
    });
    return;
  }

  const ch = roomGetCharacterByName(room, chName);
  if (ch) {
    if (facing === Facing.RIGHT2) {
      facing = Facing.RIGHT;
    } else if (facing === Facing.RIGHT_UP2) {
      facing = Facing.RIGHT_UP;
    } else if (facing === Facing.RIGHT_DOWN2) {
      facing = Facing.RIGHT_DOWN;
    }
    characterSetFacing(ch, facing);
  } else {
    console.error(
      'Cannot set facing, no character named:',
      chName,
      'facing=',
      facing
    );
  }
};

export const partySetFacing = (facing: Facing) => {
  const player = getCurrentPlayer();
  player.party.forEach(ch => {
    setFacing(ch.name, facing);
  });
};

/**
 * Shakes the screen for the given number of milliseconds, defaults to 1 second if not provided.
 *
 * ```
 * // shake screen for 500 milliseconds
 * +shakeScreen(500);
 * ```
 */
export const shakeScreen = (ms?: number, skipWait?: boolean) => {
  const canvasContainer = document.getElementById('canvas-container');
  if (canvasContainer) {
    canvasContainer.className = 'shake';
  }
  if (skipWait) {
    setTimeout(() => {
      if (canvasContainer) {
        canvasContainer.className = '';
      }
    }, ms ?? 1000);
    return;
  }
  //

  return waitMS(ms ?? 1000, () => {
    if (canvasContainer) {
      canvasContainer.className = '';
    }
  });
};

/**
 * Sets the given character at the position (x, y), where x and y are in world coordinates
 * (not Tile coordinates).  'z' is an optional param which defaults to 0.
 *
 * ```
 * // set Ada at position 100, 100, in the current room
 * +setCharacterAt("Ada", 100, 100);
 * ```
 */
export const setCharacterAt = (
  chName: string,
  x: number,
  y: number,
  z?: number
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        setCharacterAt(ch.name, x, y, z);
      }
    });
    return;
  }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  characterSetPos(ch, [x, y, z ?? 0]);
};

export const offsetCharacter = (
  chName: string,
  x: number,
  y: number,
  z?: number
) => {
  const room = getCurrentRoom();

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        offsetCharacter(ch.name, x, y, z);
      }
    });
    return;
  }

  const ch = roomGetCharacterByName(room, chName);
  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  const [cX, cY, cZ] = characterGetPos(ch);

  x = parseInt((x ?? 1) as any);
  y = parseInt((y ?? 1) as any);
  z = parseInt((z ?? 0) as any);

  if (isNaN(x)) {
    console.error('Could not offset character, the offsetX is NaN', x, y, z);
    return;
  }
  if (isNaN(y)) {
    console.error('Could not offset character, the offsetX is NaN', x, y, z);
    return;
  }
  if (isNaN(z)) {
    console.error('Could not offset character, the offsetZ is NaN', x, y, z);
    return;
  }

  characterSetPos(ch, [cX + x, cY + y, cZ + z]);
};

/**
 * Starts the given character moving towards a marker.  They will move in a straight line
 * directly at the marker until they reach it. Specifically this means that their FEET will
 * be within a 4 pixel radius at the bottom of the marker. Once that character reaches the
 * destination, the next line in the script is invoked.
 *
 * Here Ada has walked to the marker, and her feet at the bottom, where it points.
 *
 * ![Example Image](../res/docs/AdaAtMarker.png)
 *
 * Optional params (xOffset, yOffset) can be provided to change the final destination of
 * the character.  This is useful for telling multiple characters to walk towards a marker
 * but you don't want them all standing in exactly the same spot.  X and Y specified
 * in world coordinates, a y offset of -1 will move the target up right one unit
 * on the screen.  Each tile is 16 units, so -16 will move the target up 1 tile.
 *
 * Optional param skipWait may be set to `true` if the cutscene should set the character
 * to walk towards the marker, but not wait for that character to reach their destination
 * before the next line in the script is invoked.
 *
 * For example, if it is desired to have two characters walk simultaneously together:
 *
 * ```
 * +walkToMarker("Ada", "MarkerA", 0, 0, true);
 * +walkToMarker("Conscience", "MarkerA", 16, 0);
 * // This accounts for some cases where the offset might make Ada move slower/faster than
 * // Conscience.
 * +waitMS(100);
 * ```
 *
 * NOTE: If a character cannot reach the intended location, then they will
 * get warped there by the game engine.
 */
export const walkToMarker = (
  chName: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number,
  skipWait?: boolean
) => {
  none();
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const marker = room.markers[markerName];

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        walkToMarker(
          ch.name,
          markerName,
          xOffset,
          yOffset,
          ch === player.leader ? skipWait : true
        );
      }
    });
    return !skipWait;
  }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }
  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number', xOffset);
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number', yOffset);
    return;
  }

  // this offset puts the character's feet on the bottom of the marker
  const target = [
    marker.x + (xOffset ?? 0),
    marker.y + (yOffset ?? 0),
  ] as Point;

  ch.aiState.walkDisableResetIdle = false;
  if (skipWait) {
    characterSetWalkTarget(ch, target, () => void 0);
  } else {
    characterSetWalkTarget(ch, target, waitUntil());
    return true;
  }
};

export const walkToPoint = (
  chName: string,
  x: number,
  y: number,
  xOffset?: number,
  yOffset?: number,
  skipWait?: boolean
) => {
  none();
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        walkToPoint(
          ch.name,
          x,
          y,
          xOffset,
          yOffset,
          ch === player.leader ? skipWait : true
        );
      }
    });
    return !skipWait;
  }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number', xOffset);
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number', yOffset);
    return;
  }

  // this offset puts the character's feet on the bottom of the marker
  const target = [x + (xOffset ?? 0), y + (yOffset ?? 0)] as Point;

  ch.aiState.walkDisableResetIdle = false;
  if (skipWait) {
    characterSetWalkTarget(ch, target, () => void 0);
  } else {
    characterSetWalkTarget(ch, target, waitUntil());
    return true;
  }
};

export const walkToCharacter = (
  chName: string,
  chName2: string,
  xOffset?: number,
  yOffset?: number,
  skipWait?: boolean
) => {
  none();
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const ch2 = roomGetCharacterByName(room, chName2);

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        walkToCharacter(
          ch.name,
          chName2,
          xOffset,
          yOffset,
          ch === player.leader ? skipWait : true
        );
      }
    });
    return !skipWait;
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

  ch.aiState.walkDisableResetIdle = false;
  if (skipWait) {
    characterSetWalkTarget(ch, target, () => void 0);
  } else {
    characterSetWalkTarget(ch, target, waitUntil());
    return true;
  }
};

/**
 * Same as walkToMarker except instantly sets the character at the provided marker.
 */
export const setAtMarker = (
  chName: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  // const room = getCurrentRoom();
  // const ch = roomGetCharacterByName(room, chName);
  // const marker = room.markers[markerName];

  // if (chName.toLowerCase() === 'party') {
  //   const player = getCurrentPlayer();
  //   player.party.forEach(ch => {
  //     if (roomGetCharacterByName(room, ch.name)) {
  //       setAtMarker(ch.name, markerName, xOffset, yOffset);
  //     }
  //   });
  //   return;
  // }

  // xOffset = undefNaN(xOffset);
  // yOffset = undefNaN(yOffset);

  // if (!ch) {
  //   console.error('Could not find character with name: ' + chName);
  //   return;
  // }
  // if (!marker) {
  //   console.error('Could not find target marker with name: ' + markerName);
  //   return;
  // }
  // if (xOffset !== undefined && typeof xOffset !== 'number') {
  //   console.error('xOffset is not a number');
  //   return;
  // }
  // if (yOffset !== undefined && typeof yOffset !== 'number') {
  //   console.error('yOffset is not a number');
  //   return;
  // }

  // // this offset puts the character's feet on the bottom of the marker
  // const target = [
  //   marker.x + (xOffset ?? 0),
  //   marker.y + (yOffset ?? 0),
  //   marker.z,
  // ] as Point3d;

  // HACK SKYE BATTLE XD
  // if (chName === 'Skye' && getCurrentBattle()) {
  //   target[0] += 4;
  //   target[1] += 4;
  // }

  // characterSetPos(ch, target);
  setCharacterAtMarker(chName, markerName, xOffset, yOffset);
};

export const setAtPoint = (
  chName: string,
  x: number,
  y: number,
  z: number,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        setAtPoint(ch.name, x, y, z, xOffset, yOffset);
      }
    });
    return;
  }

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

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

  if (ch) {
    // this offset puts the character's feet on the bottom of the marker
    const target = [
      Math.floor(x + (xOffset ?? 0)),
      Math.floor(y + (yOffset ?? 0)),
      0,
    ] as Point3d;

    characterSetPos(ch, target);

    if (ch === getCurrentPlayer().leader) {
      getCurrentPlayer().tileLayer = roomGetTileLayerPrefixForZ(room, z / 2);
      roomSetCurrentTileLayer(room, getCurrentPlayer().tileLayer);
    }
  }
};

/**
 * Starts the given character moving towards the point (xOffset, yOffset) specified
 * relative to that character's current position.  They will move in a straight line
 * directly at the target until they reach it. Specifically this means that their FEET will
 * be within a 4 pixel radius at the bottom of the marker. Once that character reaches the
 * destination, the next line in the script is invoked.
 *
 * Optional param skipWait may be set to `true` if the cutscene should set the character
 * to walk towards the marker, but not wait for that character to reach their destination
 * before the next line in the script is invoked.
 *
 * ```
 * // Have Conscience walk one tile to the right and one tile downwards (she will walk
 * // diagonally.)
 * +walkToOffset('Conscience', 16, 16)
 * ```
 *
 * NOTE: If a character cannot reach the intended location, then they will
 * get warped there by the game engine.
 */
export const walkToOffset = (
  chName: string,
  xOffset?: number,
  yOffset?: number,
  skipWait?: boolean
) => {
  none();
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        walkToOffset(
          ch.name,
          xOffset,
          yOffset,
          ch === player.leader ? skipWait : true
        );
      }
    });
    return !skipWait;
  }

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (xOffset === undefined) {
    console.error('xOffset is not a number');
    return;
  }
  if (yOffset === undefined) {
    console.error('yOffset is not a number');
    return;
  }

  const target = [ch.x + xOffset, ch.y + yOffset] as Point;

  ch.aiState.walkDisableResetIdle = false;
  if (skipWait) {
    characterSetWalkTarget(ch, target, () => void 0);
  } else {
    characterSetWalkTarget(ch, target, waitUntil());
    return true;
  }
};

/**
 * Sets a character so that their feet are located where the marker is pointing.  Optional
 * xOffset and yOffset can be specified relative to the marker.  The character and the
 * marker must exist in the current room.
 *
 * ```
 * // Set Ada at 'MarkerPlayer'
 * +setCharacterAtMarker('Ada', 'MarkerPlayer');
 * // Set Conscience one tile to the right of Ada. (Each tile is 16 units wide and tall)
 * +setCharacterAtMarker('Conscience', 'MarkerPlayer', 16, 0);
 * ```
 */
export const setCharacterAtMarker = (
  chName: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const marker = room.markers[markerName];

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        setCharacterAtMarker(ch.name, markerName, xOffset, yOffset);
      }
    });
    return;
  }

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
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

  if (ch && marker) {
    // this offset puts the character's feet on the bottom of the marker
    const target = [
      Math.floor(marker.x + (xOffset ?? 0)),
      Math.floor(marker.y + (yOffset ?? 0)),
      marker.z,
    ] as Point3d;

    characterSetPos(ch, target);

    if (ch === getCurrentPlayer().leader) {
      getCurrentPlayer().tileLayer = roomGetTileLayerPrefixForZ(
        room,
        marker.z / 2
      );
      roomSetCurrentTileLayer(room, getCurrentPlayer().tileLayer);
    }
  }
};

export const setCharacterAtCharacter = (
  chName: string,
  ch2Name: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const ch2 = roomGetCharacterByName(room, ch2Name);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        setCharacterAtCharacter(ch.name, ch2Name, xOffset, yOffset);
      }
    });
    return;
  }

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (!ch2) {
    console.error('Could not find target character 2 with name: ' + ch2Name);
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

  if (ch && ch2) {
    // this offset puts the character's feet on the bottom of the marker
    const target = [
      Math.floor(ch2.x + (xOffset ?? 0)),
      Math.floor(ch2.y + (yOffset ?? 0)),
      ch.z,
    ] as Point3d;

    characterSetPos(ch, target);

    if (ch === getCurrentPlayer().leader) {
      getCurrentPlayer().tileLayer = roomGetTileLayerPrefixForZ(
        room,
        ch2.z / 2
      );
      roomSetCurrentTileLayer(room, getCurrentPlayer().tileLayer);
    }
  }
};

/**
 * Changes the tile beneath the given marker to the tile template specified by the
 * tileTemplateName.  These are specified in `_db/tiles`.  Both the tile template and
 * marker must exist for this to work.  Optional xOffset and yOffset can be specified
 * relative to the marker to select a different tile.
 *
 * ```
 * // Set the tiles beneath markerDoorA and one tile to the right + the tiles below
 * // markerDoorB and one tile to the right to be the respective tile templates.
 * +changeTileAtMarker(markerDoorA, RED_DOOR_BCK_CLOSED2);
 * +changeTileAtMarker(markerDoorA, RED_DOOR_BCK_CLOSED1, 16, 0);
 * +changeTileAtMarker(markerDoorB, RED_DOOR_BCK_CLOSED2);
 * +changeTileAtMarker(markerDoorB, RED_DOOR_BCK_CLOSED1, 16, 0);
 * ```
 */
export const changeTileAtMarker = (
  markerName: string | Marker,
  tileTemplateName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();

  // HACK reusing this for custom function in tut dungeon, needs to accept markerName
  // or the marker itself
  const marker =
    typeof markerName === 'string' ? room.markers[markerName] : markerName;
  const tileTemplate = getTileTemplateIfExists(tileTemplateName);

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!tileTemplate) {
    console.error(
      'Could not get a tile template with name: ' + tileTemplateName
    );
    return;
  }
  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
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

  if (marker) {
    const target = [
      marker.x + (xOffset ?? 0),
      marker.y + (yOffset ?? 0),
    ] as Point;
    const prefix = roomGetTileLayerPrefixForMarker(room, marker);
    console.log(
      'Change tile at marker',
      marker,
      target,
      tileTemplateName,
      prefix
    );
    changeTileAtPosition(target[0], target[1], tileTemplateName, prefix);
  }
};

export const changeTileAtPosition = (
  x: number | string,
  y: number | string,
  tileTemplateName: string,
  tileLayer?: TileLayerPrefix
) => {
  const room = getCurrentRoom();
  x = Number(x);
  y = Number(y);

  const tile = roomGetTileBelow(room, [x, y], tileLayer);
  if (!tile) {
    console.error(
      `Could not get a tile below the provided position: ${x}, ${y}`
    );
    return;
  }
  const tileTemplate = getTileTemplateIfExists(tileTemplateName);
  if (!tileTemplate) {
    console.error(
      'Could not get a tile template with name: ' + tileTemplateName
    );
    return;
  }
  // getTileTemplateIfExists always copies, so this is pointless
  // if (tileTemplate === tile.tileTemplate) {
  //   return;
  // }

  let tileRoInd = -1;
  let floorRoInd = -1;

  tileRoInd = room.renderObjects.indexOf(tile.ro as any);
  if (tileRoInd > -1) {
    // room.renderObjects.splice(ind, 1);
    if (tile.floorTileBeneath?.ro) {
      floorRoInd = room.renderObjects.indexOf(tile.floorTileBeneath?.ro as any);
      if (floorRoInd > -1) {
        // room.renderObjects.splice(ind2, 1);
      }
    }
  }

  const floorTileTemplate = tileTemplate.floorTile
    ? getTileTemplateIfExists(tileTemplate.floorTile)
    : undefined;

  const spriteInfo = getSprite(tileTemplate.baseSprite);
  const spriteInfoFloor = getSprite(
    tileTemplate.floorTile ?? room.defaultFloorSprite
  );

  console.log('change tile at position', tile, tileTemplate, floorTileTemplate);

  const tl = roomGetTileLayer(room, tileLayer ?? 'Default');
  const isTiles2 = Boolean(floorTileTemplate);
  const tileAddProps = {
    i: tile.i,
    tiledTileId: undefined,
    tileProperties: {
      sprite: tileTemplate.baseSprite,
      tileWidth: tileTemplate.size?.[0] ?? spriteInfo[3],
      tileHeight: tileTemplate.size?.[1] ?? spriteInfo[4],
    },
    tileLayerTiles: tl.tiles,
    isFromTiles2: isTiles2,
    floorTileProperties: floorTileTemplate
      ? {
          sprite: floorTileTemplate?.baseSprite ?? room.defaultFloorSprite,
          tileWidth: floorTileTemplate?.size?.[0] ?? spriteInfoFloor[3],
          tileHeight: floorTileTemplate?.size?.[1] ?? spriteInfoFloor[4],
        }
      : isTiles2
        ? {
            sprite: tile.floorTileBeneath?.sprite ?? room.defaultFloorSprite,
            tileWidth: spriteInfoFloor[3],
            tileHeight: spriteInfoFloor[4],
          }
        : undefined,
    tileTemplate: tileTemplate,
    floorTileTemplate: floorTileTemplate ?? undefined,
    isLow: false,
    skipAddRo: true,
    zOffset: tl.zOffset,
  };
  const tileAdded = roomAddTile(room, tileAddProps);

  if (tileRoInd > -1 && tileAdded.ro) {
    room.renderObjects.splice(tileRoInd, 1, tileAdded.ro);
  } else if (tileAdded.ro) {
    // this wont invalidate the floor ind, since it's being put at the end, though
    // it is probably faster to splice it in the correct place than let the game
    // sort it
    room.renderObjects.push(tileAdded.ro);
  }
  // if there is an existing floor ind
  if (floorRoInd > -1) {
    // if the replacement tile has a floor tile
    if (tileAdded.floorTileBeneath?.ro) {
      room.renderObjects.splice(floorRoInd, 1, tileAdded.floorTileBeneath?.ro);
    } else {
      // note that this will invalidate the roInds: floorRoInd and tileRoInd
      room.renderObjects.splice(floorRoInd, 1);
    }
  } else if (tileAdded.floorTileBeneath?.ro) {
    // if no existing floor and the replacement tile has a floor tile
    room.renderObjects.push(tileAdded.floorTileBeneath?.ro);
  }

  return tileAdded;

  // tile.isWall = tileTemplate.isWall ?? tile.isWall;
  // tile.isProp = tileTemplate.isProp ?? tile.isProp;

  // if (tile.ro) {
  //   tile.sprite = tileTemplate.baseSprite;
  //   tile.ro.sprite = tileTemplate.baseSprite;
  //   // if (tileTemplate.pxOffset) {
  //   //   tile.ro.px = (tile.ro.px ?? 0) + tileTemplate.pxOffset[0];
  //   //   tile.ro.py = (tile.ro.py ?? 0) + tileTemplate.pxOffset[1];
  //   // }

  //   // it was a wall/prop, but now it's not, so remove the floor tile beneath it.
  //   // must be === false (instead of !hasFloorTile) because of the nature of undefined defaults
  //   if (tile.floorTileBeneath && tileTemplate.hasFloorTile === false) {
  //     const ind = room.renderObjects.indexOf(tile.floorTileBeneath?.ro as any);
  //     if (ind > -1) {
  //       room.renderObjects.splice(ind, 1);
  //       tile.floorTileBeneath = undefined;
  //     }
  //   }

  //   if (tileTemplate.animName && tile.animName !== tileTemplate.animName) {
  //     if (tileTemplate.animName) {
  //       tile.animName = tileTemplate.animName;
  //       if (hasAnimation(tile.animName)) {
  //         const anim = createAnimation(tileTemplate.animName);
  //         anim.start();
  //         tile.ro.anim = anim;
  //       }
  //     } else {
  //       tile.ro.anim = undefined;
  //     }
  //   }

  //   if (tileTemplate.size) {
  //     tile.tileWidth = tileTemplate.size[0];
  //     tile.tileHeight = tileTemplate.size[1];
  //   }

  //   if (tileTemplate.floorTile) {
  //     const floorTileTemplate = getTileTemplateIfExists(tileTemplate.floorTile);
  //     if (floorTileTemplate) {
  //       const floorTile = {
  //         ...tile,
  //         ...floorTileTemplate,
  //         sprite: floorTileTemplate.baseSprite,
  //         tileWidth: 32,
  //         tileHeight: 32,
  //       } as Tile;
  //       const roFloor = createTileRenderObject(floorTile);
  //       roFloor.sortY -= 6;
  //       floorTile.ro = roFloor;
  //       if (tile.floorTileBeneath) {
  //         const ind = room.renderObjects.indexOf(
  //           tile.floorTileBeneath?.ro as any
  //         );
  //         if (ind > -1) {
  //           room.renderObjects.splice(ind, 1, roFloor);
  //         } else {
  //           room.renderObjects.push(roFloor);
  //         }
  //         tile.floorTileBeneath = floorTile;
  //       } else {
  //         room.renderObjects.push(roFloor);
  //         tile.floorTileBeneath = floorTile;
  //       }
  //     } else {
  //       console.error(
  //         `Floor tile specified by tile db for tile ${tileTemplateName} does not exist: `,
  //         tileTemplate.floorTile
  //       );
  //     }
  //   }

  //   const ind = room.renderObjects.indexOf(tile.ro as any);
  //   if (ind > -1) {
  //     // console.log('CHANGE TILE', tile.ro);
  //     const anim = tile.ro.anim;
  //     const sortY = tile.ro.sortY;
  //     tile.ro = createTileRenderObject(tile);
  //     // console.log('NEW RO', tile.ro);
  //     tile.ro.anim = anim;
  //     tile.ro.sortY = sortY + (tileTemplate?.sortOffset ?? 0);
  //     if (tileTemplate.onAfterCreation) {
  //       tileTemplate.onAfterCreation(tile);
  //     }
  //     room.renderObjects.splice(ind, 1, tile.ro);
  //   }

  //   applyTileTemplate(tile, tileTemplate);
  // }
};

export const addOrReplaceTileAtMarkerEx = (
  markerName: string | Marker,
  tileTemplateName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();

  const marker =
    typeof markerName === 'string' ? room.markers[markerName] : markerName;
  const tileTemplate = getTileTemplateIfExists(tileTemplateName);

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!tileTemplate) {
    console.error(
      'Could not get a tile template with name: ' + tileTemplateName
    );
    return;
  }
  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
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

  if (marker) {
    const target = [
      marker.x + (xOffset ?? 0),
      marker.y + (yOffset ?? 0),
    ] as Point;
    addOrReplaceTileAtPositionEx(target[0], target[1], tileTemplateName);
  }
};

export const addOrReplaceTileAtPositionEx = (
  x: number | string,
  y: number | string,
  tileTemplateName: string
) => {
  const room = getCurrentRoom();
  x = Number(x);
  y = Number(y);

  let i =
    Math.floor(y / TILE_HEIGHT_WORLD) * room.width +
    Math.floor(x / TILE_WIDTH_WORLD);

  // Remove existing tile and floor tile (if it exists)
  const tile = roomGetTileBelow(room, [x, y], room.currentTileLayer);
  let roInd = -1;
  if (tile) {
    i = tile.i;
    if (tile.ro) {
      const ind = room.renderObjects.indexOf(tile.ro as any);
      if (ind > -1) {
        // room.renderObjects.splice(ind, 1);
        roInd = ind;
      }
    }
    // const floorTile = tile.floorTileBeneath;
    // if (floorTile?.ro) {
    //   const ind = room.renderObjects.indexOf(floorTile.ro as any);
    //   if (ind > -1) {
    //     room.renderObjects.splice(ind, 1);
    //   }
    // }
  }

  // build add tile args
  const args: IRoomAddTileArgs = {
    i,
    isFromTiles2: false,
    tileLayerTiles: roomGetCurrentTileLayer(room).tiles,
    baseTileLayer: {
      width: room.width,
      height: room.height,
      data: roomGetCurrentTileLayer(room).tiles.map(t => t.i),
    },
  };

  const tileTemplate = getTileTemplateIfExists(tileTemplateName);
  if (!tileTemplate) {
    console.error(
      'Could not get a tile template with name: ' + tileTemplateName
    );
    return;
  }
  if (!tileTemplate.size) {
    console.error(
      'Cannot addOrReplaceTileAtPositionEx, tile template does not have a size: ' +
        tileTemplateName
    );
    return;
  }

  if (tileTemplate.floorTile) {
    const floorTileTemplate = getTileTemplateIfExists(tileTemplate.floorTile);
    args.isFromTiles2 = true;
    if (!floorTileTemplate) {
      console.error(
        'Could not get a floor tile template with name: ' +
          tileTemplate.floorTile
      );
      return;
    }
    if (!floorTileTemplate.size) {
      console.error(
        'Cannot addOrReplaceTileAtPositionEx, floor tile template does not have a size: ' +
          floorTileTemplate.floorTile
      );
      return;
    }
    args.floorTileProperties = {
      sprite: floorTileTemplate.baseSprite,
      tileWidth: floorTileTemplate.size[0],
      tileHeight: floorTileTemplate.size[1],
    };
    args.floorTileTemplate = floorTileTemplate;
  }

  args.tileTemplate = tileTemplate;
  args.tileProperties = {
    sprite: tileTemplate.baseSprite,
    tileWidth: tileTemplate.size[0],
    tileHeight: tileTemplate.size[1],
  };
  if (roInd > -1) {
    args.roIndex = roInd;
  }

  roomAddTile(room, args);
};

export const removeWallAtMarker = (
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const marker = room.markers[markerName];

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }
  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number', xOffset);
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number', yOffset);
    return;
  }

  if (marker) {
    const target = [
      marker.x + (xOffset ?? 0),
      marker.y + (yOffset ?? 0),
    ] as Point;

    const tile = roomGetTileBelow(
      room,
      target,
      roomGetTileLayerPrefixForZ(room, marker.z)
    );
    if (!tile) {
      console.error(
        'Could not get a tile below the provided marker: ' + markerName
      );
      return;
    }
    tile.isWall = false;
    tile.isProp = false;

    if (tile.ro) {
      if (tile.floorTileBeneath) {
        const ind = room.renderObjects.indexOf(tile.ro as any);
        if (ind > -1) {
          room.renderObjects.splice(ind, 1);
        }
      }
    }
  }
};

export const removeWallAtTilePosition = (tileX: number, tileY: number) => {
  const room = getCurrentRoom();
  if (typeof tileX !== 'number') {
    console.error('tileX is not a number', tileX);
    return;
  }
  if (typeof tileY !== 'number') {
    console.error('tileY is not a number', tileY);
    return;
  }
  const tile = roomGetTileAt(room, tileX, tileY, room.currentTileLayer);

  if (tile) {
    if (!tile) {
      console.error(
        'Could not get a tile at the provided position: ' +
          [tileX, tileY].join(',')
      );
      return;
    }
    tile.isWall = false;
    tile.isProp = false;

    if (tile.ro) {
      if (tile.floorTileBeneath) {
        const ind = room.renderObjects.indexOf(tile.ro as any);
        if (ind > -1) {
          room.renderObjects.splice(ind, 1);
        }
      }
    }
  }
};

/**
 * Spawn a character in the current room of the given chTemplateName, on top of the
 * character specified by chName (at the same [x,y] coordinates).  Optional xOffset and
 * yOffset may be specified relative to the target location.  The target character
 * must exist in the room, and the character to be spawned must have a template defined
 * inside `_db/characters`;
 *
 * ```
 * // Spawn Conscience on top of Ada
 * +spawnCharacterAtCharacter('Conscience', 'Ada');
 * ```
 */
export const spawnCharacterAtCharacter = (
  chTemplateName: string,
  chName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const chTemplate = getCharacterTemplateIfExists(chTemplateName);

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!chTemplate) {
    console.error(
      'Could not get a character template with name: ' + chTemplateName
    );
    return;
  }
  if (!ch) {
    console.error(
      'Could not find target character to spawnCharacterAtCharacter with name: ' +
        chName
    );
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

  const target = [
    ch.x + (xOffset ?? 0),
    ch.y + (yOffset ?? 0),
    ch.z,
  ] as Point3d;
  const existingCh = roomGetCharacterByName(room, chTemplate.name);

  if (existingCh) {
    console.log(
      'The character to be spawned already exists in the current room: ' +
        chTemplate.name
    );
    characterSetPos(existingCh, target);
    return;
  }

  const spawnCh = characterCreateFromTemplate(chTemplate);
  characterSetPos(spawnCh, target);
  roomAddCharacter(room, spawnCh);
};

/**
 * Spawn a character in the current room of the given chTemplateName, on top of the
 * marker specified by markerName (the character's feet will be where the marker is
 * pointing. Optional xOffset and yOffset may be specified relative to the target location.
 * The marker must exist in the room, and the character to be spawned must have a template
 * defined inside `_db/characters`;
 *
 * ```
 * // Spawn Skye at MarkerSkyeSpawnPoint
 * +spawnCharacterAtMarker('Skye', 'MarkerSkyeSpawnPoint');
 * ```
 */
export const spawnCharacterAtMarker = (
  chTemplateName: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  let marker = room.markers[markerName];
  const chTemplate = getCharacterTemplateIfExists(chTemplateName);

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!chTemplate) {
    console.error(
      'Could not get a character template with name: ' + chTemplateName
    );
    return;
  }
  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    marker = room.markers['MarkerPlayer'];
  }
  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number');
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number');
    return;
  }

  // console.log(
  //   'SPAWN CHARACTER AT MARKER',
  //   chTemplateName,
  //   markerName,
  //   xOffset,
  //   yOffset
  // );

  const target = [
    marker.x + (xOffset ?? 0),
    marker.y + (yOffset ?? 0),
    marker.z,
  ] as Point3d;
  const existingCh = roomGetCharacterByName(room, chTemplate.name);

  if (existingCh) {
    console.log(
      'The character to be spawned already exists in the current room: ' +
        chTemplate.name
    );
    characterSetPos(existingCh, target);
    return;
  }
  const spawnCh = characterCreateFromTemplate(chTemplate);
  characterSetPos(spawnCh, target);
  roomAddCharacter(room, spawnCh);
};

export const spawnPartyMembers = (skipWait?: boolean) => {
  const player = getCurrentPlayer();
  const partyWithoutLeader = player.partyStorage.filter(
    ch => ch !== player.leader && !ch.hiddenFromParty
  );

  const d = 12;
  const offsets = [
    [d, 1],
    [1, -d],
    [-d, 1],
    [1, d],
  ];

  const room = getCurrentRoom();

  partyWithoutLeader.forEach((chTemplate, i) => {
    const offset = offsets[i];
    spawnCharacterAtCharacter(
      chTemplate.name,
      player.leader.name,
      offset?.[0],
      offset?.[1]
    );
    const ch = roomGetCharacterByName(room, chTemplate.name);
    if (ch) {
      const target = [ch.x + offset[0], ch.y + offset[1]] as Point;
      characterSetWalkTarget(ch, target, () => {
        lookAtCharacter(ch.name, player.leader.name);
      });
    }
  });

  if (skipWait) {
    return;
  }

  return waitMS(1000);
};

export const despawnPartyMembers = (skipWait?: boolean) => {
  const player = getCurrentPlayer();
  const leader = player.leader;
  const room = getCurrentRoom();
  const partyWithoutLeader = player.party.filter(
    ch => ch !== player.leader && roomGetCharacterByName(room, ch.name)
  );

  partyWithoutLeader.forEach(chTemplate => {
    const ch = roomGetCharacterByName(room, chTemplate.name);
    if (ch) {
      const target = [leader.x, leader.y] as Point;
      characterSetWalkTarget(ch, target, () => {
        roomRemoveCharacter(room, ch);
      });
    }
  });

  if (skipWait) {
    return;
  }

  return waitMS(1000);
};

export const spawnPartyMembersInFormation = (showParticles?: boolean) => {
  const room = getCurrentRoom();
  const player = getCurrentPlayer();
  const partyWithoutLeader = player.party.filter(ch => ch !== player.leader);

  const d = 16;
  const offsets = [
    [d, 1],
    [1, -d],
    [-d, 1],
    [1, d],
  ];

  partyWithoutLeader.forEach((chTemplate, i) => {
    if (chTemplate.name === 'Conscience' && !shouldSpawnConscience()) {
      return;
    }

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
      lookAtCharacter(ch.name, player.leader.name);
      if (showParticles) {
        spawnParticleAtCharacter(
          'EFFECT_TEMPLATE_PORTAL_SPAWN',
          ch.name,
          'normal'
        );
      }
    }
  });
};

export const walkPartyToFormation = (skipWait?: boolean, offset?: number) => {
  const player = getCurrentPlayer();

  const cb = () => {
    for (const partyCh of player.party) {
      const roomCh = roomGetCharacterByName(getCurrentRoom(), partyCh.name);
      if (roomCh && partyCh !== player.leader) {
        characterSetFacing(roomCh, player.leader.facing);
      }
    }
    if (!skipWait) {
      sceneStopWaitingForTime(getSceneForCommands());
    }
  };

  walkPartyToFormationOverworld(player.leader, { offset }).then(cb);
  if (skipWait) {
    return;
  }

  return waitUntil();
};

export const setPartyAtFormation = (offset = 16) => {
  const player = getCurrentPlayer();
  const partyWithoutLeader = player.party.filter(ch => ch !== player.leader);

  const d = offset;
  const offsets = [
    [d, 0],
    [0, -d],
    [-d, 0],
    [0, d],
  ];

  partyWithoutLeader.forEach((chTemplate, i) => {
    const offset = offsets[i];
    const room = getCurrentRoom();
    if (roomGetCharacterByName(room, chTemplate.name)) {
      setCharacterAtCharacter(
        chTemplate.name,
        player.leader.name,
        offset?.[0],
        offset?.[1]
      );
      setFacing(chTemplate.name, player.leader.facing);
    }
  });
};

/**
 * Remove the character from the current room.  The character must exist in the current room.
 *
 * ```
 * // Remove Skye from the room
 * +despawnCharacter('Skye');
 * ```
 */
export const despawnCharacter = (chName: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      despawnCharacter(ch.name);
    });
    return;
  }

  if (!ch) {
    console.error('Could not find character with name: "' + chName + '"');
    return;
  }

  roomRemoveCharacter(room, ch);
};

/**
 * Fade the world screen to black.  Optional ms can be specified for how long the fade
 * takes.  Optional skipWait can be specified to not wait for this command to finish
 * before executing the next one.
 */
export const fadeOut = (ms?: number, skipWait?: boolean) => {
  const scene = getSceneForCommands();
  if (scene.skip) {
    return;
  }

  const localMs = ms ?? 750;
  const canvasContainer = document.getElementById('fade');
  if (canvasContainer) {
    canvasContainer.style.transition = `background-color ${localMs}ms`;
    canvasContainer.style['background-color'] = 'rgba(0, 0, 0, 255)';
  }
  if (!skipWait) {
    return waitMS(localMs);
  }
};

/**
 * Fade the world screen back in.  Optional ms can be specified for how long the fade
 * takes.  Optional skipWait can be specified to not wait for this command to finish
 * before executing the next one.
 */
export const fadeIn = (ms?: number, skipWait?: boolean) => {
  const scene = getSceneForCommands();
  if (!scene || scene?.skip) {
    return;
  }

  const localMs = ms ?? 1000;
  const canvasContainer = document.getElementById('fade');
  if (canvasContainer) {
    canvasContainer.style.transition = `background-color ${localMs}ms`;
    canvasContainer.style['background-color'] = 'rgba(0, 0, 0, 0)';
  }
  if (!skipWait) {
    return waitMS(localMs);
  }
};

/**
 * Fade the world screen to black.  Optional ms can be specified for how long the fade
 * takes.  Optional skipWait can be specified to not wait for this command to finish
 * before executing the next one.
 */
export const fadeOutColor = (
  r: number,
  g: number,
  b: number,
  ms?: number,
  skipWait?: boolean
) => {
  const localMs = ms ?? 750;
  const canvasContainer = document.getElementById('fade');
  if (canvasContainer) {
    canvasContainer.style.transition = `background-color ${localMs}ms`;
    canvasContainer.style['background-color'] = `rgba(${r}, ${g}, ${b}, 255)`;
  }
  if (!skipWait) {
    return waitMS(localMs);
  }
};

/**
 * Fade the world screen back in.  Optional ms can be specified for how long the fade
 * takes.  Optional skipWait can be specified to not wait for this command to finish
 * before executing the next one.
 */
export const fadeInColor = (
  r: number,
  g: number,
  b: number,
  ms?: number,
  skipWait?: boolean
) => {
  const localMs = ms ?? 1000;
  const canvasContainer = document.getElementById('fade');
  if (canvasContainer) {
    canvasContainer.style.transition = `background-color ${localMs}ms`;
    canvasContainer.style['background-color'] = `rgba(${r}, ${g}, ${b}, 0)`;
  }
  if (!skipWait) {
    return waitMS(localMs);
  }
};

/**
 * Change the room and put the player at the given markerName in the next room.  If not
 * specified, the player is put at MarkerPlayer or if that does not exist (0, 0).
 *
 * When using a marker, the player will be facing a direction depending on the marker type.
 */
export const changeRoom = (roomName: string, nextRoomMarkerName?: string) => {
  const player = getCurrentPlayer();
  const overworldTemplate = getOverworld(roomName);
  if (!player) {
    console.error('Player has not been initialized.');
    return;
  }
  if (!overworldTemplate) {
    console.error('No overworld template exists with name:', roomName);
    return;
  }

  const initialOverworld = getCurrentOverworld();
  if (initialOverworld.music !== overworldTemplate.music) {
    stopCurrentMusic(650);
  }

  const overworld = initiateOverworld(player, overworldTemplate, {
    markerName: nextRoomMarkerName,
  });
  // need this here or the transition during a cutscene breaks and the game thinks you are
  // both in a cutscene and out of one
  if (overworld) {
    overworld.triggersEnabled = false;
  }
  return true;
};

/**
 * Give an item to the player.  Dialogue will play indicating the item that was given,
 * or this text can be overridden by optional itemText param.
 */
export const acquireItem = (
  itemName: string,
  itemText?: string,
  skipText?: boolean
) => {
  const player = getCurrentPlayer();
  const item = getItem(itemName);
  if (!item) {
    console.error(
      `Cannot acquire item "${itemName}" no template exists with that name.`
    );
    return;
  }

  if (playerAddItem(player, itemName)) {
    if (item.events?.onAcquire) {
      return item.events.onAcquire(item, player);
    } else if (!skipText) {
      playSound('get_item2');
      return playDialogue({
        actorName: 'Narrator',
        text:
          itemText ??
          `Acquired: icon:${item.icon ?? 'help'} <color=LIGHTBLUE>${
            item.label
          }</>.`,
      });
    }
  }
};

/**
 * Give an item to the player.  Dialogue will play indicating the item that was given,
 * or this text can be overridden by optional itemText param.
 */
export const acquireQuestItem = (itemName: string, itemText?: string) => {
  const player = getCurrentPlayer();

  const item = getItem(itemName);
  if (!item) {
    console.error(
      `Cannot acquireQuestItem "${itemName}" no template exists with that name.`
    );
    return;
  }

  if (playerAddItem(player, itemName)) {
    playSound('get_item2');
    return playDialogue({
      actorName: 'Narrator',
      text:
        itemText ??
        `Acquired: icon:${item.icon ?? 'help'} <color=LIGHTBLUE>${
          item.label
        }</>.`,
    });
  }
};

/**
 * Remove an item from the player.  Dialogue will play indicating the item that was removed,
 * or this text can be overridden by optional itemText param.
 */
export const removeItem = (itemName: string, itemText?: string) => {
  const player = getCurrentPlayer();

  const item = getItem(itemName);
  if (!item) {
    console.error(
      `Cannot remove item "${itemName}" no template exists with that name.`
    );
    return;
  }

  if (playerRemoveItem(player, itemName)) {
    playSound('lose_item');
    return playDialogue({
      actorName: 'Narrator',
      text:
        itemText ??
        `Removed: icon:${item.icon ?? 'help'} <color=LIGHTBLUE>${
          item.label
        }</>.`,
    });
  }
};

/**
 * Add/remove Tokens from the player, and show a dialogue indicating how much was gained/lost.
 */
export const modifyTokens = (amount: number | string) => {
  const numberAmount = Number(amount as string);
  const player = getCurrentPlayer();
  playerModifyTokens(player, parseInt(amount as string));
  if (numberAmount >= 0) {
    playSoundName('token_get');
    return playDialogue({
      actorName: 'Narrator',
      text: `Gained ${amount} icon:YELLOW_token <color=YELLOW>Regem Ludos Tokens</>.`,
    });
  } else {
    playSoundName('lose_token');
    return playDialogue({
      actorName: 'Narrator',
      text: `Removed ${-amount} icon:YELLOW_token <color=LIGHTRED>Regem Ludos Tokens</>.`,
    });
  }
};

/**
 * Add/remove Tickets from the player, and show a dialogue indicating how much was gained/lost.
 */
export const modifyTickets = (amount: number | string) => {
  const numberAmount = Number(amount as string);
  const player = getCurrentPlayer();
  playerModifyTickets(player, parseInt(amount as string));
  if (numberAmount >= 0) {
    playSound('chime');
    return playDialogue({
      actorName: 'Narrator',
      text: `Gained ${amount} icon:WHITE_ticket <color=LIGHTBLUE>Prize Tickets</>.`,
    });
  } else {
    playSound('lose_item');
    return playDialogue({
      actorName: 'Narrator',
      text: `Removed ${-amount} icon:WHITE_ticket <color=LIGHTRED>Prize Tickets</>.`,
    });
  }
};

/**
 * Make the given character jump into the air and come back down.
 */
export const jump = (chName: string, skipWait?: boolean) => {
  const room = getCurrentRoom();

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        jump(ch.name, skipWait);
      }
    });
    return;
  }

  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  const [, , originalZ] = characterGetPos(ch);

  const jumpAsync = (height: number): Promise<void> => {
    return new Promise(resolve => {
      if (skipWait) {
        timeoutPromise(33).then(() => {
          const pos = characterGetPos(ch);
          pos[2] = originalZ + height;
          characterSetPos(ch, pos);
          resolve();
        });
      } else {
        waitMS(33, () => {
          const pos = characterGetPos(ch);
          pos[2] = originalZ + height;
          characterSetPos(ch, pos);
          resolve();
        });
      }
    });
  };

  setConversationSpeaker(CutsceneSpeaker.None);

  const performJump = async () => {
    await jumpAsync(8);
    await jumpAsync(16);
    await jumpAsync(20);
    await jumpAsync(22);
    await jumpAsync(20);
    await jumpAsync(16);
    await jumpAsync(8);
    await jumpAsync(0);
    if (!skipWait) {
      waitMS(150);
    }
  };
  performJump();
  if (!skipWait) {
    playSound('jump_cutscene');
    return true;
  }
};

export const applyZTransform = (
  chName: string,
  z: number,
  ms?: number,
  includeFloor?: boolean,
  skipWait?: boolean
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        applyZTransform(ch.name, z, ms, includeFloor, skipWait);
      }
    });
    return;
  }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  const startPoint = characterGetPos(ch);
  const endPoint = [...startPoint] as Point3d;
  endPoint[2] += z;
  const msTime = ms ?? 1000;

  const transform = new Transform(
    startPoint,
    endPoint,
    msTime,
    TransformEase.LINEAR
  );
  characterSetTransform(ch, transform);

  const tileBelow = roomGetTileBelow(
    room,
    startPoint.slice(0, 2) as Point,
    room.currentTileLayer
  );
  if (includeFloor) {
    if (tileBelow) {
      const startPoint = tileGetPosition(tileBelow);
      const endPoint = [...startPoint] as Point3d;
      endPoint[2] += z;
      console.log(
        'CREATE TILE TRANSFORM',
        startPoint,
        endPoint,
        JSON.stringify(tileBelow, null, 2)
      );
      const transformTile = new Transform(
        startPoint,
        endPoint,
        msTime,
        TransformEase.LINEAR
      );
      tileBelow.transform = transformTile;
    }
  }

  if (skipWait) {
    timeoutPromise(msTime).then(() => {
      characterSetPos(ch, endPoint);
      ch.transform = null;
      if (includeFloor && tileBelow && tileBelow.transform) {
        tileBelow.transform.shouldRemove = true;
        // tileBelow.z = tileBelow.transform?.endZ;
        // tileBelow.transform = undefined;
      }
      return undefined;
    });
    return;
  }
  return waitMS(msTime, () => {
    characterSetPos(ch, endPoint);
    ch.transform = null;
    if (includeFloor && tileBelow && tileBelow.transform) {
      tileBelow.transform.shouldRemove = true;
      // tileBelow.z = tileBelow.transform?.endZ;
      // tileBelow.transform = undefined;
    }
  });
};

export const applyZTransformTileAtMarker = (
  markerName: string,
  z: number,
  ms?: number,
  skipWait?: boolean
) => {
  return applyZTransformTileAtMarkerEx(markerName, z, 0, 0, ms, skipWait);
};

export const applyZTransformTileAtMarkerEx = (
  markerName: string,
  z?: number,
  xOffset?: number,
  yOffset?: number,
  ms?: number,
  skipWait?: boolean
) => {
  const room = getCurrentRoom();
  const marker = room.markers[markerName];
  const msTime = ms ?? 1000;

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);
  z = undefNaN(z) ?? 0;

  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }

  const _applyTransform = (tile: Tile) => {
    const startPoint = tileGetPosition(tile);
    const endPoint = [...startPoint] as Point3d;
    endPoint[2] += z as number;
    const transformTile = new Transform(
      startPoint,
      endPoint,
      msTime,
      TransformEase.LINEAR
    );
    console.log(
      'apply transform to',
      tile.sprite,
      'from',
      startPoint,
      'to',
      endPoint
    );
    tile.transform = transformTile;
    if (skipWait) {
      timeoutPromise(msTime).then(() => {
        if (tile && tile.transform) {
          tile.transform.shouldRemove = true;
          // tile.z = tile.transform.endZ;
          // tile.transform = undefined;
        }
        // if (tile.floorTileBeneath && tile.floorTileBeneath.transform) {
        //   tile.floorTileBeneath.z =
        //     tile.floorTileBeneath.z + tile.floorTileBeneath.transform?.endZ;
        //   tile.floorTileBeneath.transform = undefined;
        // }
        return undefined;
      });
    }
  };

  const tileBelow = roomGetTileBelow(
    room,
    [marker.x + (xOffset ?? 0), marker.y + (yOffset ?? 0)],
    room.currentTileLayer
  );
  if (tileBelow) {
    _applyTransform(tileBelow);
    if (tileBelow.floorTileBeneath) {
      _applyTransform(tileBelow.floorTileBeneath);
    }

    if (skipWait) {
      return;
    }
    return waitMS(msTime, () => {
      if (tileBelow && tileBelow.transform) {
        tileBelow.z = tileBelow.transform.endZ;
        tileBelow.transform = undefined;
      }
      if (tileBelow.floorTileBeneath && tileBelow.floorTileBeneath.transform) {
        tileBelow.floorTileBeneath.z =
          tileBelow.floorTileBeneath.transform.endZ;
        tileBelow.floorTileBeneath.transform = undefined;
      }
    });
  } else {
    console.error(
      'Error in applyZTransformTileAtMarkerEx, Could not find tile below marker: ' +
        markerName,
      'with offsets',
      xOffset,
      yOffset
    );
  }
};

/**
 * Show the ArcadeCabinet component and run the given game inside it.  The gameName is the
 * string key for the enum of games in that component.  NOTE: Also pauses the overworld.
 */
export const runArcadeCabinetGame = (gameName: string) => {
  const gamePath = ArcadeGamePath[gameName as keyof typeof ArcadeGamePath];
  if (!gamePath) {
    console.error('No game exists with name:', gameName);
    return;
  }

  playSoundName('start_arcade_game');
  hideSection(AppSection.Cutscene);
  showArcadeGame(gamePath);
  // return waitUntil();
};

export const hideCurrentArcadeGame = () => {
  hideArcadeGame();
};

/**
 * Override a character's animation with the given animName, and wait for it to finish.
 * If the animation is looped this will return immediately.  msOffset is the time offset
 * from the end of the animation in milliseconds to stop waiting.  When it is over, the
 * animation state is set to IDLE.
 */
export const setAnimationAndWait = (
  chName: string,
  animName: string,
  msOffset?: number
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  if (!hasAnimation(animName)) {
    console.error('Could not find animation with name: ' + animName);
    return;
  }

  const anim = createAnimation(animName);
  characterOverrideAnimation(ch, anim);
  const ms = anim.getDurationMs();
  return waitMS(ms + (msOffset ?? 0), () => {
    setAnimationState(chName, AnimationState.IDLE);
  });
};

/**
 * Override a character's animation with the given animName.
 */
export const setAnimation = (chName: string, animName: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  if (!hasAnimation(animName)) {
    console.error('Could not find animation with name: ' + animName);
    return;
  }

  console.log('SET ANIMATION FOR CH', chName, animName);
  const anim = createAnimation(animName);
  characterOverrideAnimation(ch, anim);
};

/**
 * Set the Animation State of a character.  These states - like 'idle','walk' etc -
 * are defined in model/Character as an enum.
 */
export const setAnimationState = (chName: string, state: AnimationState) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        setAnimationState(ch.name, state);
      }
    });
    return;
  }

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  characterSetAnimationState(ch, state);
};

export const setSpeed = (chName: string, speed?: number) => {
  const room = getCurrentRoom();

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        setSpeed(ch.name, speed);
      }
    });
    return;
  }

  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (speed === undefined || isNaN(Number(speed))) {
    speed = ch.template?.speed ?? 1;
  }

  characterSetSpeed(ch, speed);
};

export const resetAi = (chName: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  characterStartAi(ch);
};
export const startAi = resetAi;

export const stopAi = (chName: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  characterStopAi(ch);
};

/**
 * Open/Close a set of doors at the marker.  The marker must be placed on the door above
 * the other door (pixel above, not iso above.)
 */
export const setDoorStateAtMarker = (
  markerName: string,
  tileBase: string,
  doorDirection: string | 'BCK' | 'FWD',
  doorState: string | 'OPEN' | 'CLOSED'
) => {
  if (!['BCK', 'FWD'].includes(doorDirection)) {
    console.error(
      'Cannot setDoorStateAtMarker. Invalid door direction (needs BCK or FWD)'
    );
    return;
  }
  if (!['OPEN', 'CLOSED'].includes(doorState)) {
    console.error(
      'Cannot setDoorStateAtMarker. Invalid door state (needs OPEN or CLOSED)'
    );
    return;
  }

  if (doorDirection === 'BCK') {
    changeTileAtMarker(
      markerName,
      `${tileBase}_${doorDirection}_${doorState}2`
    );
    changeTileAtMarker(
      markerName,
      `${tileBase}_${doorDirection}_${doorState}1`,
      16,
      0
    );
  } else {
    changeTileAtMarker(
      markerName,
      `${tileBase}_${doorDirection}_${doorState}2`
    );
    changeTileAtMarker(
      markerName,
      `${tileBase}_${doorDirection}_${doorState}1`,
      0,
      16
    );
  }
};

export const awaitChoice = (...choices: string[]) => {
  setTimeout(() => {
    choices.forEach((c, i) => {
      setStorage(`CHOICE${i}`, c);
    });

    showChoices(choices, false);
  }, 33);
  stopSkipCutscene();
  return waitUntil();
};

// NOTE: The skip version of this must be manually edited if you create a new EX type
// in this function!!
export const awaitChoiceEx = (type: string, ...choices: string[]) => {
  if (type === 'reverse') {
    choices
      .slice()
      .reverse()
      .forEach((c, i) => {
        setStorage(`CHOICE${i}`, c);
      });

    setTimeout(() => {
      showChoices(choices, true);
    }, 33);
    return waitUntil();
  } else if (type === 'array') {
    const newChoices = choices?.[0]?.split(',').filter(item => !!item) ?? [
      undefined,
    ];
    newChoices.forEach((c, i) => {
      setStorage(`CHOICE${i}`, c);
    });

    setTimeout(() => {
      showChoices(newChoices, false);
    }, 33);
    return waitUntil();
  }
  stopSkipCutscene();
  return awaitChoice(...choices);
};

export const enterCombat = (encounterName: string, skipIntro?: boolean) => {
  stopSkipCutscene();
  return waitMS(100, () => {
    const encounter = getEncounter(encounterName);
    if (!encounter) {
      console.error('No encounter exists with name:', encounterName);
      return;
    }

    setUnskippable(true);

    overworldHide(getCurrentOverworld());
    playSoundName('battle_encountered');

    battleV2StartFromOverworld(
      encounter,
      {
        areEnemiesSurprised: false,
      },
      getCurrentOverworld(),
      getCurrentPlayer()
    );
  });
};

export const addPartyMemberToActiveParty = (chName: string) => {
  playerAddToActiveParty(getCurrentPlayer(), chName);
};

export const removePartyMemberFromActiveParty = (
  chName: string,
  unEquipItems?: boolean
) => {
  const player = getCurrentPlayer();
  if (unEquipItems) {
    const ch = playerGetPartyMember(player, chName);
    if (ch) {
      if (ch.equipmentV2.weapon) {
        characterUnEquipItemV2(ch, 'weapon');
      }
      if (ch.equipmentV2.armor) {
        characterUnEquipItemV2(ch, 'armor');
      }
      if (ch.equipmentV2.accessory1) {
        characterUnEquipItemV2(ch, 'accessory1');
      }
      if (ch.equipmentV2.accessory2) {
        characterUnEquipItemV2(ch, 'accessory2');
      }
    }
  }
  playerRemoveFromActiveParty(player, chName, true);
};

export const panCameraRelativeToPlayer = (
  relX: number,
  relY: number,
  ms?: number,
  skipWait?: boolean
) => {
  const duration = ms ?? 1000;
  const player = getCurrentPlayer();
  if (player) {
    const transform = getCameraTransform();
    const [, , unRoundedX, unRoundedY] = playerGetCameraOffset(player);
    let startX = unRoundedX;
    let startY = unRoundedY;
    if (transform) {
      const pos = transform.current();
      startX = pos[0];
      startY = pos[1];
    }
    const t = new Transform(
      [startX, startY, 0],
      [unRoundedX - relX, unRoundedY - relY, 0],
      duration,
      TransformEase.EASE_OUT
    );
    setCameraTransform(t);
    if (!skipWait) {
      return waitMS(duration);
    }
  }
};

export const panCameraRelativeToCurrentPosition = (
  relX: number,
  relY: number,
  ms?: number,
  skipWait?: boolean
) => {
  const duration = ms ?? 1000;
  const player = getCurrentPlayer();
  const offset = playerGetCameraOffset(player);
  const transform = getCameraTransform();

  let startX = 0;
  let startY = 0;

  if (transform) {
    startX = transform.endX;
    startY = transform.endY;
  } else {
    startX = offset[2];
    startY = offset[3];
  }

  const t = new Transform(
    [startX, startY, 0],
    [startX - relX, startY - relY, 0],
    duration,
    TransformEase.EASE_OUT
  );
  setCameraTransform(t);
  if (!skipWait) {
    return waitMS(duration);
  }
};

export const panCameraBackToPlayer = (ms?: number, skipWait?: boolean) => {
  none();
  const duration = ms ?? 1000;
  const player = getCurrentPlayer();
  const transform = getCameraTransform();
  if (player && transform) {
    const [, , unRoundedX, unRoundedY] = playerGetCameraOffset(player);
    const [tX, tY] = transform.current();
    const t = new Transform(
      [tX, tY, 0],
      [unRoundedX, unRoundedY, 0],
      duration,
      TransformEase.EASE_OUT
    );
    t.timer.awaits.push(() => {
      if (getCameraTransform() === t) {
        setCameraTransform(null);
      }
    });
    setCameraTransform(t);
    if (!skipWait) {
      return waitMS(duration);
    }
  }
};

export const panCameraToMarker = (
  markerName: string,
  ms?: number,
  skipWait?: boolean
) => {
  none();
  const room = getCurrentRoom();
  const marker = room.markers[markerName];
  if (!marker) {
    console.error('Could not find marker with name: ' + markerName);
    return;
  }

  const [x, y] = isoToPixelCoords(marker.x, marker.y, marker.z);
  const [screenW, screenH] = getScreenSize();
  // HACK: round x because it's odd, floor Y because it's even.  Might not always be the case
  const roomXOffset = Math.round(screenW / 2 - x - 16);
  const roomYOffset = Math.floor(screenH / 2 - y);

  const xAvg = roomXOffset;
  const yAvg = roomYOffset - 32;

  const duration = ms ?? 1000;
  const player = getCurrentPlayer();
  const transform = getCameraTransform();

  if (player) {
    const [oX, oY] = [xAvg, yAvg];
    const [tX, tY] = transform
      ? transform.current()
      : playerGetCameraOffset(player);
    const t = new Transform(
      [tX, tY, 0],
      [oX, oY, 0],
      duration,
      TransformEase.EASE_OUT
    );
    setCameraTransform(t);
    if (!skipWait) {
      return waitMS(duration);
    }
  }
};

export const panCameraToFitCharacters = (
  ms?: number,
  skipWait?: boolean,
  ...characterNames: string[]
) => {
  if (typeof (ms as any) === 'string') {
    console.error(
      'Invalid argument to panCameraToFitCharacters, did you forget ms and/or skipWait?'
    );
    return;
  }

  none();
  const room = getCurrentRoom();
  const characters: Character[] = characterNames
    .filter(chName => {
      const ch = roomGetCharacterByName(room, chName);
      if (!ch) {
        console.error(
          `error in panCameraToFitCharacters, character ${chName} does not exist in current room.`
        );
        return false;
      }
      return true;
    })
    .map(chName => {
      return roomGetCharacterByName(room, chName) as any;
    });

  if (!characters.length) {
    console.error(
      `error in panCameraToFitCharacters, no characters to pan camera to!`
    );
    return;
  }

  const cameraCenterPositions = characters.map(ch => {
    const [x, y] = isoToPixelCoords(ch.x, ch.y, ch.z);
    const [screenW, screenH] = getScreenSize();
    // HACK: round x because it's odd, floor Y because it's even.  Might not always be the case
    const roomXOffset = Math.round(screenW / 2 - x - 16);
    const roomYOffset = Math.floor(screenH / 2 - y);
    return [roomXOffset, roomYOffset];
  });

  const xAvg =
    cameraCenterPositions.reduce((sum, [x]) => {
      return sum + x;
    }, 0) / cameraCenterPositions.length;
  const yAvg =
    cameraCenterPositions.reduce((sum, [, y]) => {
      return sum + y;
    }, 0) /
      cameraCenterPositions.length -
    32;
  const duration = ms ?? 1000;
  const player = getCurrentPlayer();
  const transform = getCameraTransform();

  if (player) {
    const [oX, oY] = [xAvg, yAvg];
    const [tX, tY] = transform
      ? transform.current()
      : playerGetCameraOffset(player);
    const t = new Transform(
      [tX, tY, 0],
      [oX, oY, 0],
      duration,
      TransformEase.EASE_OUT
    );
    setCameraTransform(t);
    if (!skipWait) {
      return waitMS(duration);
    }
  }
};

export const panCameraBattle = (
  position: 'ALLY' | 'CENTER' | 'ENEMY',
  ms = 300,
  skipWait = false
) => {
  none();
  if (position === 'ALLY') {
    battleV2PanCameraToRelativePosition('enemy', ms);
  } else if (position === 'ENEMY') {
    battleV2PanCameraToRelativePosition('ally', ms);
  } else {
    battleV2PanCameraToRelativePosition('center', ms);
  }
  if (!skipWait) {
    return waitMS(ms);
  }
};

export const playSound = (
  soundName: string,
  repeat?: number,
  repeatEvery?: number
) => {
  if (repeat && repeatEvery) {
    const soundObj = getSound(soundName);
    if (soundObj) {
      playSoundName(soundName);
      for (let i = 1; i < repeat; i++) {
        timeoutPromise(i * repeatEvery).then(() => {
          playSoundName(soundName);
        });
      }
    } else {
      console.error('No sound exists with name: ' + soundName);
    }
  } else {
    playSoundName(soundName);
  }
};

export const playMusic = (musicName: string) => {
  stopCurrentMusic(100).then(() => {
    playMusicName(musicName, true);
  });
};

export const stopMusic = (ms = 1000, skipWait = true) => {
  const duration = ms ?? 1000;
  stopCurrentMusic(duration);
  if (!skipWait) {
    return waitMS(duration);
  }
};

// not actually a scene command, but used by them
export const spawnParticleAtTarget = (
  template: ParticleTemplate,
  target: Point,
  particleMethod: 'normal' | 'weighted' | 'rise' | 'credits',
  ...args: string[]
) => {
  const room = getCurrentRoom();
  if (particleMethod === 'normal') {
    const particle = particleCreateFromTemplate(target, template);
    roomAddParticle(room, particle);
  } else if (particleMethod === 'weighted') {
    roomAddParticle(
      room,
      createWeightedParticle(template, target[0], target[1], template.duration)
    );
  } else if (particleMethod === 'rise') {
    roomAddParticle(
      room,
      createRiseParticle(template, target[0], target[1], template.duration)
    );
  } else if (particleMethod === 'credits') {
    const particle = createCreditsParticle(
      args?.[0] ?? '',
      parseInt(args?.[1] ?? '0'),
      parseInt(args?.[2] ?? '0')
    );
    roomAddParticle(room, particle);
  } else {
    console.error(`Particle method not known: "${particleMethod}"`);
  }
};

export const spawnParticleEx = (
  particleMethod: 'normal' | 'weighted' | 'rise' | 'credits',
  ...args: string[]
) => {
  const room = getCurrentRoom();
  if (particleMethod === 'credits') {
    const particle = createCreditsParticle(
      args?.[0] ?? '',
      parseInt(args?.[1] ?? '0'),
      parseInt(args?.[2] ?? '0')
    );
    roomAddParticle(room, particle);
  }
};

export const spawnParticleAtCharacter = (
  particleName: string,
  chName: string,
  particleMethod: 'normal' | 'weighted' | 'rise',
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        spawnParticleAtCharacter(
          particleName,
          ch.name,
          particleMethod,
          xOffset,
          yOffset
        );
      }
    });
    return;
  }

  const ch = roomGetCharacterByName(room, chName);
  const template = getParticle(particleName);

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  if (!template) {
    console.error('Could not find particle with name: ' + particleName);
    return;
  }

  const target = characterGetPosCenterPx(ch);
  target[0] += xOffset ?? 0;
  target[1] += yOffset ?? 0;
  spawnParticleAtTarget(template, target, particleMethod);
};

export const spawnEmotionParticleAtCharacter = (
  chName: string,
  emotion: EmotionBubble,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        spawnEmotionParticleAtCharacter(ch.name, emotion, xOffset, yOffset);
      }
    });
    return;
  }

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  const particle = createEmotionBubbleParticle(ch, emotion, [
    xOffset ?? 0,
    yOffset ?? 0,
  ]);
  roomAddParticle(room, particle);
};

export const spawnParticleAtMarker = (
  particleName: string,
  markerName: string,
  particleMethod: 'normal' | 'weighted' | 'rise' = 'normal',
  offsetX?: number,
  offsetY?: number
) => {
  const room = getCurrentRoom();
  const template = getParticle(particleName);

  const marker = room.markers[markerName];

  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }

  if (!template) {
    console.error('Could not find particle with name: ' + particleName);
    return;
  }

  let [x, y]: Point = isoToPixelCoords(
    marker.x + (offsetX ?? 0),
    marker.y + (offsetY ?? 0)
  );
  // this appears to work for any sized particles
  x += 16;
  y += 16;
  spawnParticleAtTarget(template, [x, y], particleMethod);
};

export const setCharacterText = (text: string) => {
  const oldText = getUiInterface().appState.overworld.characterText;
  if (oldText !== text) {
    setCharacterTextUi(text);
  }
};

export const showUISection = (sectionName: string, ...args: any[]) => {
  if (sectionName === 'BattleUI') {
    showSection(AppSection.BattleUI, true);
  } else if (sectionName === 'BattleUICutscene') {
    showSection(AppSection.BattleUI, false);
  } else if (sectionName === 'Debug' || sectionName === 'Game') {
    showSection(AppSection.Debug, true);
  } else if (sectionName === 'Save') {
    showSave(() => {
      sceneStopWaitingUntil(getSceneForCommands());
      showSection(AppSection.Debug, true);
      unpause();
    });
    return waitUntil();
  } else if (sectionName === 'LevelUp') {
    showLevelUp(() => {
      sceneStopWaitingUntil(getSceneForCommands());
      showSection(AppSection.Debug, true);
      unpause();
    });
    return waitUntil();
  } else if (sectionName === 'CharacterStatus') {
    showCharacterStatus(() => {
      sceneStopWaitingUntil(getSceneForCommands());
      showSection(AppSection.Debug, true);
      unpause();
    });
    return waitUntil();
  } else if (sectionName === 'Modal') {
    setCutsceneSkipEnabled(false);
    const meta: Record<string, string> = {};

    const modalType: ModalSection = args[0];
    const title: string = args[1];
    const body: string = args[2];
    const otherArgs = args.slice(3);

    console.log('SHOW MODAL', {
      modalType,
      title,
      body,
      otherArgs,
    });

    if (modalType === ModalSection.INPUT_DIGITS) {
      meta.maxDigits = otherArgs[0];
    }

    showModal(modalType, {
      title,
      body,
      onClose: () => {
        sceneStopWaitingUntil(getSceneForCommands());
        setCutsceneSkipEnabled(true);

        // HACK need to render ui since game goes from paused to unpaused after this.
        setTimeout(() => {
          renderUi();
        }, 100);
      },
      meta,
    });
    return waitUntil();
  } else if (sectionName === 'InfoStats') {
    setCutsceneSkipEnabled(false);

    none();

    showInfoStatsSection(() => {
      hideInfoStatsSection();
      unpause();

      setCutsceneSkipEnabled(true);
      hideStoreSection();
      sceneStopWaitingUntil(getSceneForCommands());
      const scene = getSceneForCommands();
      scene.inputDisabled = false;
    });
    return waitUntil();
  } else if (sectionName === 'Intro') {
    setCutsceneSkipEnabled(true);
    showIntroSection(() => {
      hideInfoStatsSection();
      // sceneStopWaitingUntil(getSceneForCommands());
    });
    // return waitUntil();
  } else if (sectionName == 'Title') {
    window.location.reload();
  }
};

export const pauseOverworld = () => {
  const overworld = getCurrentOverworld();
  if (overworld) {
    pause();
  }
};

export const unpauseOverworld = () => {
  const overworld = getCurrentOverworld();
  if (overworld) {
    unpause();
  }
};

export const equipWeaponOrArmor = (itemName: string, chName: string) => {
  const player = getCurrentPlayer();
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  const chParty = player.partyStorage.find(ch => ch.name === chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  const item = player.backpack.find(itm => itm.name === itemName);
  if (!item) {
    console.error(
      `Cannot equipWeaponOrArmor '${itemName}', no item of that name is in the Player's backpack`
    );
  } else {
    const slot = determineSlotForItemTemplate(item);
    if (slot.includes('accessory')) {
      console.error(
        'Cannot equip accessory to character during equipWeaponOrArmor: ' +
          chName
      );
      return;
    }
    characterEquipItemV2(ch, item, 'weapon');
    if (chParty) {
      characterEquipItemV2(chParty, item, 'weapon');
    }
  }
};

// tutorial uses this to display tooltips
export const setBattlePaused = (isPaused: string) => {
  const battle = getCurrentBattle();
  if (battle) {
    if (isPaused === 'true') {
      battle.isPaused = true;
      battleV2InvokeEvent(battle, BattleV2Event.onGamePaused, battle);
      // battleV2AddAutomation(
      //   battle,
      //   new BattleV2AsyncAutomationBattleOnly(
      //     new PauseBattleParticipantsBattleOnly(),
      //     0
      //   )
      // );
    } else {
      battle.isPaused = false;
      battleV2InvokeEvent(battle, BattleV2Event.onGameUnpaused, battle);
      // battleV2AddAutomation(
      //   battle,
      //   new BattleV2AsyncAutomationBattleOnly(
      //     new UnpauseBattleParticipantsBattleOnly(),
      //     0
      //   )
      // );
    }
  }
};

// useful for interrupting custom ai
export const setAiState = (
  chName: string,
  aiStateKey: string,
  value: string | boolean
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  if (value === 'true' || value === 'false') {
    value = value === 'true';
  }

  ch.aiState[aiStateKey] = value;
};

const startQuest = (questName: string) => {
  const scene = getSceneForCommands();
  const quest = getQuest(questName);

  if (!quest) {
    console.error(
      `Could not startQuest.  No quest exists with name: ${questName}`
    );
  }

  none();

  beginQuestFromManagement(scene, questName);
  scene.inputDisabled = true;
  playSoundName('quest_started');
  playSoundName('menu_choice_open');
  showQuestSection(questName, () => {
    hideQuestSection();
    sceneStopWaitingUntil(getSceneForCommands());
    scene.inputDisabled = false;
  });
  return waitUntil();
};

const startQuestQuiet = (questName: string) => {
  const scene = getSceneForCommands();
  const quest = getQuest(questName);

  if (!quest) {
    console.error(
      `Could not startQuestQuiet.  No quest exists with name: ${questName}`
    );
  }
  beginQuestFromManagement(scene, questName);
};

const completeQuestStep = (questName: string, stepInd: number) => {
  const scene = getSceneForCommands();
  const quest = getQuest(questName);

  if (!quest) {
    console.error(
      `Could not completeQuestStep.  No quest exists with name: ${questName}`
    );
  }

  none();

  const stepCompleted = completeQuestStepFromManagement(
    scene,
    questName,
    stepInd
  );

  if (questIsCompleted(scene, quest as QuestTemplate)) {
    scene.inputDisabled = true;
    playSoundName('quest_completed');
    // setConversation('Ada', 0);
    // none();
    // setCutsceneText('');
    // setConversationSpeaker(CutsceneSpeaker.None);
    showQuestSection(questName, () => {
      hideQuestSection();
      sceneStopWaitingUntil(getSceneForCommands());
      scene.inputDisabled = false;
    });
    return waitUntil();
  } else if (stepCompleted) {
    if (
      !sceneHasNotificationsToShow(getCurrentScene(), 'quest-' + quest?.label)
    ) {
      scenePushNotificationToShow(getCurrentScene(), 'quest-' + quest?.label);
      showNotification('Journal updated: ' + quest?.label);
    }
  }
};

const completeQuestSubStep = (
  questName: string,
  stepInd: number,
  subStepInd: number
) => {
  const scene = getSceneForCommands();
  const quest = getQuest(questName);

  if (!quest) {
    console.error(
      `Could not completeQuestSubStep.  No quest exists with name: ${questName}`
    );
  }

  none();

  if (
    completeQuestSubStepFromManagement(scene, questName, stepInd, subStepInd)
  ) {
    if (
      !sceneHasNotificationsToShow(getCurrentScene(), 'quest-' + quest?.label)
    ) {
      scenePushNotificationToShow(getCurrentScene(), 'quest-' + quest?.label);
      showNotification('Journal updated: ' + quest?.label);
    }
  }
};

const showNotification = (
  text: string,
  type?: 'info' | 'success' | 'warning' | 'danger'
) => {
  sceneAddPostSceneCallback(getSceneForCommands(), () => {
    // delay this so that the black bars can disappear before the notification flies in
    setTimeout(() => {
      playSoundName('notification');
      showNotificationUi({
        text,
        type: type ?? 'info',
      });
    }, 500);
  });
};

const modifyPartyHP = (v: number) => {
  const player = getCurrentPlayer();
  player.party.forEach(ch => {
    characterModifyHp(ch, v);
  });
};

const modifyPartyRESV = (v: number) => {
  const player = getCurrentPlayer();
  player.party.forEach(ch => {
    characterModifyResv(ch, v);
  });
};

const disableAnimationSounds = () => {
  Animation.disableSoundsGlobally();
};

const enableAnimationSounds = () => {
  Animation.enableSoundsGlobally();
};

// offsetPX and PY are in PIXEL coords, not world coords
const changePropAnim = (
  propName: string,
  animName: string,
  offsetPX?: number,
  offsetPY?: number
) => {
  const props = roomGetProps(getCurrentRoom(), propName);

  if (!props.length) {
    console.error('Cannot change prop, no prop in room is named: ' + propName);
    return;
  }

  if (animName !== 'invisible' && !hasAnimation(animName)) {
    console.error(
      `Cannot change prop ${propName} to ${animName}, no anim is named: ` +
        animName
    );
    return;
  }

  for (const prop of props) {
    if (!prop.ro) {
      console.error(
        `Cannot change prop ${propName} to ${animName}, the prop does not hae an RO in the room.`
      );
      return;
    }

    const anim = createAnimation(animName);
    anim.start();
    prop.ro.anim = anim;
    if (prop.ro.px !== undefined && prop.ro.py !== undefined) {
      prop.ro.px += offsetPX ?? 0;
      prop.ro.py += offsetPY ?? 0;
    }
  }
};

const changeTileAnim = (px: number, py: number, animName: string) => {
  const room = getCurrentRoom();
  const x = Math.floor(px / 16);
  const y = Math.floor(py / 16);
  const tile = roomGetTileAt(room, x, y);

  if (!tile) {
    console.error(
      `Cannot change tile at ${x}, ${y}, no tile exists at that location.`
    );
    return;
  }

  if (animName !== 'invisible' && !hasAnimation(animName)) {
    console.error(
      `Cannot change tile at ${x}, ${y} to ${animName}, no anim is named: ` +
        animName
    );
    return;
  }

  const anim = createAnimation(animName);
  anim.start();
  if (tile.ro) {
    tile.ro.anim = anim;
  }
};

const createPropAtMarker = (
  propName: string,
  markerName: string,
  spriteName: string,
  sortOffset?: number,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const marker = room.markers[markerName];

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }
  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number', xOffset);
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number', yOffset);
    return;
  }
  if (sortOffset !== undefined && typeof sortOffset !== 'number') {
    console.error('sortOffset is not a number', yOffset);
    return;
  }
  // if (spriteName && !getSprite(spriteName)) {
  //   console.error('no sprite exists with name: ', spriteName);
  //   return;
  // }

  console.log('ADD PROP', propName);

  const target = [
    marker.x + (xOffset ?? 0),
    marker.y + (yOffset ?? 0),
  ] as Point;

  roomAddProp(room, {
    name: propName,
    tileLayerPrefix: roomGetTileLayerPrefixForZ(room, marker.z),
    sprite: spriteName,
    target,
    sortOffset,
  });
};

const createPropAtCharacter = (
  propName: string,
  chName: string,
  spriteName: string,
  sortOffset?: number,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);
  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number', xOffset);
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number', yOffset);
    return;
  }
  if (sortOffset !== undefined && typeof sortOffset !== 'number') {
    console.error('sortOffset is not a number', yOffset);
    return;
  }
  if (!getSprite(spriteName)) {
    console.error('no sprite exists with name: ', spriteName);
    return;
  }

  const target = [ch.x + (xOffset ?? 0), ch.y + (yOffset ?? 0)] as Point;

  roomAddProp(room, {
    name: propName,
    tileLayerPrefix: roomGetTileLayerPrefixForCharacter(room, ch),
    sprite: spriteName,
    target,
    sortOffset,
  });
};

const removeProp = (propName: string) => {
  const room = getCurrentRoom();
  const prop = roomGetProp(room, propName);

  if (!prop) {
    console.error('Cannot remove prop, no prop in room is named: ' + propName);
    return;
  }

  roomRemoveProp(room, prop);
};

const movePropToOffset = (
  propName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const prop = roomGetProp(room, propName);

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!prop) {
    console.error('Cannot move prop, no prop in room is named: ' + propName);
    return;
  }
  if (xOffset === undefined) {
    console.error('xOffset is not a number', xOffset);
    return;
  }
  if (yOffset === undefined) {
    console.error('yOffset is not a number', yOffset);
    return;
  }

  prop.x += xOffset;
  prop.y += yOffset;

  const ro = createPropRenderObject(prop);
  if (prop.ro) {
    Object.assign(prop.ro, ro);
  }
};

const showStore = (storeName: string) => {
  if (storeName === 'SELL') {
    setCutsceneSkipEnabled(false);

    none();
    hideConversation();

    showSellSection(() => {
      setCutsceneSkipEnabled(true);
      hideSellSection();
      sceneStopWaitingUntil(getSceneForCommands());
      const scene = getSceneForCommands();
      scene.inputDisabled = false;
    });
    return waitUntil();
  } else {
    const store = getStore(storeName);
    if (!store) {
      console.error('Cannot get item store, no store is named: ' + storeName);
    }

    setCutsceneSkipEnabled(false);

    none();
    hideConversation();

    showStoreSection(storeName, () => {
      setCutsceneSkipEnabled(true);
      hideStoreSection();
      sceneStopWaitingUntil(getSceneForCommands());
      const scene = getSceneForCommands();
      scene.inputDisabled = false;
    });
    return waitUntil();
  }
};

export const setPlayerVisibility = (visible: boolean) => {
  const player = getCurrentPlayer();
  if (player) {
    player.visible = Boolean(visible);
  }
};

const setCharacterSpriteBase = (chName: string, spriteBase: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  ch.spriteBase = spriteBase;
};

const resetCharacterSpriteBase = (chName: string, chTemplateName?: string) => {
  const chTemplate = getCharacterTemplateIfExists(chTemplateName ?? chName);
  if (!chTemplate) {
    console.error(
      'Could not find character template with name: ' +
        (chTemplateName ?? chName)
    );
    return;
  }
  setCharacterSpriteBase(chName, chTemplate.spriteBase);
};

const setFlashbackMode = (on: boolean) => {
  setFlashbackModeOn(on);
};

export const addOverlay = (
  imageName: string,
  blendMethod: string,
  ms?: number,
  skipWait?: boolean
) => {
  const room = getCurrentRoom();

  const overlay: OverworldOverlay = {
    imageName,
    blendMethod: blendMethod as any,
  };

  if (ms) {
    overlay.timer = new Timer(ms);
    overlay.timer.start();
  }

  room.overlays.push(overlay);
  if (!skipWait && ms) {
    return waitMS(ms);
  }
};

export const removeOverlay = (
  imageName: string,
  blendMethod?: string,
  ms?: number,
  skipWait?: boolean
) => {
  const room = getCurrentRoom();
  const ind = room.overlays.findIndex(
    overlay =>
      overlay.imageName === imageName &&
      (blendMethod === undefined ? true : overlay.blendMethod === blendMethod)
  );

  if (ind > -1) {
    if (ms) {
      const overlay = room.overlays[ind];
      overlay.fadingOut = true;
      overlay.timer = new Timer(ms);

      if (skipWait) {
        timeoutPromise(ms).then(() => {
          const ind = room.overlays.indexOf(overlay);
          if (ind > -1) {
            room.overlays.splice(ind, 1);
          }
        });
      } else {
        return waitMS(ms, () => {
          const ind = room.overlays.indexOf(overlay);
          if (ind > -1) {
            room.overlays.splice(ind, 1);
          }
        });
      }
    } else {
      room.overlays.splice(ind, 1);
    }
  }
};

const removeOverlays = (ms?: number, skipWait?: boolean) => {
  const room = getCurrentRoom();
  if (ms) {
    for (let i = 0; i < room.overlays.length; i++) {
      const overlay = room.overlays[i];
      overlay.fadingOut = true;
      overlay.timer = new Timer(ms);
    }
    if (skipWait) {
      timeoutPromise(ms).then(() => {
        room.overlays = [];
      });
    } else {
      return waitMS(ms, () => {
        room.overlays = [];
      });
    }
  } else {
    room.overlays = [];
  }
};

const characterSetTalkTrigger = (chName: string, talkTriggerName: string) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  ch.talkTrigger = talkTriggerName;
};

const characterSetSortOffset = (chName: string, offset: number) => {
  const room = getCurrentRoom();
  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }
  ch.sortOffset = Number(offset);
  if (isNaN(ch.sortOffset)) {
    delete ch.sortOffset;
  }
};

const stopSkipCutscene = () => {
  getSceneForCommands().skip = false;
  setCutsceneSkipEnabled(true);
  return true;
};

// min max inclusive
const setRandomInt = (key: string, min: number, max: number) => {
  sceneSetStorage(getSceneForCommands(), key, getRandBetween(min, max));
};

const stashOverworld = () => {
  overworldStashOverworld();
};

const unstashOverworld = () => {
  overworldUnstashOverworld();
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

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  const target = [
    marker?.x + (xOffset ?? 0) + 8,
    marker?.y + (yOffset ?? 0) + 8,
  ] as Point;

  dropCurrentlyHeldProps(
    getCurrentPlayer(),
    markerName ? target : undefined,
    true
  );
  return waitMS(100);
};

const removeTriggerNotifierAtMarker = (
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const marker = room.markers[markerName];

  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (xOffset !== undefined && typeof xOffset !== 'number') {
    console.error('xOffset is not a number');
    return;
  }
  if (yOffset !== undefined && typeof yOffset !== 'number') {
    console.error('yOffset is not a number');
    return;
  }

  const target = [
    marker.x + (xOffset ?? 0),
    marker.y + (yOffset ?? 0),
  ] as Point;

  const tile = roomGetTileBelow(
    room,
    target,
    roomGetTileLayerPrefixForZ(room, marker.z)
  );
  if (!tile) {
    console.error(
      'Could not get a tile below the provided marker: ' + markerName
    );
    return;
  }

  if (
    tile.origSprite === SPRITE_CONTROL_EXCLAIM ||
    tile.origSprite === SPRITE_CONTROL_EXCLAIM_INVISIBLE
  ) {
    tile.origSprite = '';
  }
};

export const setWallCollisionEnabled = (v: boolean) => {
  setCutsceneDisableWalls(!v);
};

export const setPartyWalkBehindLeaderEnabled = (v: boolean) => {
  playerSetWalkBehindLeaderEnabled(getCurrentPlayer(), v);
};

export const addMarkersToTiles = (
  tileSprite: string,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (xOffset === undefined) {
    console.error('xOffset is not a number');
    return;
  }
  if (yOffset === undefined) {
    console.error('yOffset is not a number');
    return;
  }

  let ctr = 0;
  const tiles = roomGetCurrentTileLayer(room).tiles;
  for (const i in tiles) {
    const tile = tiles[i];
    // if (tile.origSprite === 'walls_17') {
    //   console.log(
    //     'CHECK FLOOR TILE BENEATH',
    //     tile.origSprite,
    //     tile.floorTileBeneath
    //   );
    // }
    if (
      tile.origSprite === tileSprite ||
      tile.floorTileBeneath?.origSprite === tileSprite
    ) {
      const target = [
        tile.x * TILE_WIDTH_WORLD + (xOffset ?? 0),
        tile.y * TILE_HEIGHT_WORLD + (yOffset ?? 0),
      ] as Point;
      const marker = {
        name: 'Marker' + markerName + ctr,
        x: target[0],
        y: target[1],

        // TODO fix this.  Use z offset of current saved tiles list in room
        z: 0,
      };
      room.markers[marker.name] = marker;
      room.renderObjects.push(createMarkerRenderObject(marker));
      ctr++;
    }
  }
};

// Use this to make a character do something asynchronously after they reach their walk target.
// This will execute the rpgscriptSrc in a separate scene parallel to the current scene.
// The script must not have a "waitMS" call as it will only execute for one frame.
const onChWalkCompleted = (
  chName: string,
  rpgscriptSrc: string,
  ...rpgscriptArgs: any[]
) => {
  const room = getCurrentRoom();

  if (chName.toLowerCase() === 'party') {
    const player = getCurrentPlayer();
    player.party.forEach(ch => {
      if (roomGetCharacterByName(room, ch.name)) {
        onChWalkCompleted(ch.name, rpgscriptSrc);
      }
    });
    return;
  }

  const ch = roomGetCharacterByName(room, chName);

  if (!ch) {
    console.error('Could not find character with name: ' + chName);
    return;
  }

  if (characterHasWalkTarget(ch)) {
    ch.onReachWalkTarget = async () => {
      // use a subscene here so that an existing scene can continue to run.
      // the script run in this subscene will run in parallel with the existing scene.
      // it can potentially modify the existing scene, but it will not block the existing scene.
      const subScene = sceneCreate();
      console.log(
        'call script after hitting walk target',
        chName,
        rpgscriptSrc
      );
      await createAndCallScript(subScene, rpgscriptSrc, ...rpgscriptArgs);
    };
  }
};

export const setRoomTileLayer = (layer: TileLayerPrefix) => {
  const room = getCurrentRoom();
  roomSetCurrentTileLayer(room, layer);
};

// change the tile at the marker from the marker's tile layer to the specified tile layer
export const swapTileLayerTileAtMarker = (
  layerPrefix: TileLayerPrefix,
  markerName: string,
  xOffset?: number,
  yOffset?: number
) => {
  const room = getCurrentRoom();
  const marker = room.markers[markerName];

  xOffset = undefNaN(xOffset);
  yOffset = undefNaN(yOffset);

  if (!marker) {
    console.error('Could not find target marker with name: ' + markerName);
    return;
  }
  const pos: Point = [marker.x + (xOffset ?? 0), marker.y + (yOffset ?? 0)];
  const tilePos = roomGetCoordsBelow(room, pos);
  const markerTileLayerPrefix = roomGetTileLayerPrefixForZ(room, marker.z);
  const tileAtMarker = roomGetTileBelow(room, pos, markerTileLayerPrefix);
  const otherTile = roomGetTileBelow(room, pos, layerPrefix);
  if (!tileAtMarker) {
    console.error(
      'Could not get a tile below the provided marker: ' + markerName
    );
    return;
  }

  console.log(
    'SWAP TILE',
    tileAtMarker.sprite + ' -> ' + `'${markerTileLayerPrefix}'`,
    'WITH THIS TILE',
    otherTile?.sprite + ' -> ' + `'${layerPrefix}'`,
    'AT COORD',
    tilePos
  );

  roomSetTileAt(room, tileAtMarker, tilePos[0], tilePos[1], layerPrefix);
  if (otherTile) {
    roomSetTileAt(
      room,
      otherTile,
      tilePos[0],
      tilePos[1],
      markerTileLayerPrefix
    );
  }
};

let cameraSkipped = false;
const lockCamera = (skipIfTransforming?: boolean) => {
  console.log('lockCamera SKIP IF TRANSFORMING', skipIfTransforming);
  if (skipIfTransforming && getCameraTransform()) {
    console.log('SKIPPED!');
    cameraSkipped = true;
    return;
  }
  setLastCameraTransform(getCameraTransform());
  return panCameraRelativeToCurrentPosition(0, 0, 1);
};

const unlockCamera = () => {
  if (cameraSkipped) {
    cameraSkipped = false;
    return;
  }
  setCameraTransform(getLastCameraTransform());
};

// CUSTOM --------------------------------------------------------------------------------

// BE CAREFUL WITH THIS
// by default, calling a script disables the keys update part of the overworld. This means
// that the player will stop moving during the execution of a script.  If the script block
// has a lot of script calls in it, each one occurs on the subsequent frame and this manifests
// as a perceived stuttering.  If you want to eliminate this, you can force the script to
// enable keys update using this function, however this means that the player can move
// around while a script is being executed.
export const forceSetUpdateKeysEnabled = () => {
  console.log('WARNING, keys being forced to be enabled');
  enableKeyUpdate();
};

export const floor1TutToggleColorDoorsWalkToOffset = () => {
  const room = getCurrentRoom();

  const TERMINAL_FACING_LEFT = 'props_27';
  const TERMINAL_FACING_RIGHT = 'props_28';

  const ch = getCurrentPlayer().leader;
  const terminalTile = roomGetNearestTileInList(room, ch, [
    TERMINAL_FACING_LEFT,
    TERMINAL_FACING_RIGHT,
  ]);
  const tilePos = characterGetTilePos(ch, room);
  if (terminalTile) {
    tilePos[0] = terminalTile.x;
    tilePos[1] = terminalTile.y;
    if (terminalTile.sprite === TERMINAL_FACING_LEFT) {
      tilePos[1]++;
    } else if (terminalTile.sprite === TERMINAL_FACING_RIGHT) {
      tilePos[0]++;
    }
  }

  const pxPos = tilePos[0] * 16 - 8;
  const pyPos = tilePos[1] * 16 - 8;
  characterSetWalkTarget(ch, [pxPos, pyPos], () => {
    const dir = roomGetDirectionOfNearestTileInList(room, ch, [
      TERMINAL_FACING_LEFT,
      TERMINAL_FACING_RIGHT,
    ]);
    characterSetFacing(ch, dir);
    const offset = facingToIncrements(dir);
    timeoutPromise(50).then(() => {
      characterSetWalkTarget(
        ch,
        [ch.x + offset[0] * 4, ch.y + offset[1] * 4],
        cb
      );
    });
  });
  const cb = waitUntil();
  return true;
};

// Used in the tutorial room to toggle open/closed all doors with the color of the marker
export const floor1TutToggleColorDoors = (
  color: string,
  shouldChangeState: string,
  isOnLoad: boolean
) => {
  const room = getCurrentRoom();
  const changeState = shouldChangeState;

  if (changeState) {
    const key = `tut_vr_${color.toLowerCase()}_doors`;
    const scene = getSceneForCommands();
    const oldValue = Number(scene.storage[key] ?? 0);
    const newValue = oldValue ? 0 : 1;
    scene.storage[key] = newValue;
  }

  const particleTemplateDeSpawn = getParticle(
    'EFFECT_TUT_DOOR_SPAWN'
  ) as ParticleTemplate;
  const particleTemplateSpawn = getParticle(
    'EFFECT_TEMPLATE_REMOVE_CH'
  ) as ParticleTemplate;

  const taggedMarkers = getAllTagMarkers(room, `TagMarker${color}`);
  for (let i = 0; i < taggedMarkers.length; i++) {
    const marker = taggedMarkers[i];
    const tile = roomGetTileBelow(room, [marker.x, marker.y]);

    if (tile) {
      if (tile.isWall) {
        changeTileAtMarker(marker, 'TUT_GATE_FLOOR');
        if (!isOnLoad) {
          let [x, y]: Point = isoToPixelCoords(marker.x + 8, marker.y + 8);
          x += 16;
          y += 16;
          spawnParticleAtTarget(particleTemplateDeSpawn, [x, y], 'normal');
        }
      } else {
        changeTileAtMarker(marker, `TUT_GATE_${color.toUpperCase()}`);
        if (!isOnLoad) {
          let [x, y]: Point = isoToPixelCoords(marker.x + 4, marker.y + 4);
          x += 16;
          y += 16;
          spawnParticleAtTarget(particleTemplateSpawn, [x, y], 'normal');
        }
      }
    }
  }
};

export const changeLeader = (chName: string) => {
  const player = getCurrentPlayer();

  if (chName.toLowerCase() === 'ada') {
    playerSaveCurrentLeaderState(player);
    playerSetLeader(player, player.leaderStorage.ada.party[0]);
  } else if (chName.toLowerCase() === 'conscience') {
    playerSaveCurrentLeaderState(player);

    // if conscience has been leader before
    if (player.leaderStorage.conscience.party.length) {
      playerSetLeader(player, player.leaderStorage.conscience.party[0]);
    } else {
      const existingLeader = player.leader;

      // make a new Conscience and set party
      const conscienceTemplate = getCharacterTemplate('Conscience');
      const conscience = characterCreateFromTemplate(conscienceTemplate);
      const storage = player.leaderStorage.conscience;

      storage.party.push(conscience);
      storage.battlePositions.push(conscience);
      playerSetLeader(player, conscience);
      playerAddItem(player, 'TrBow');
      characterEquipItemV2(
        conscience,
        player.backpack.find(item => item.name === 'TrBow') as any,
        'weapon'
      );

      const existingCh = roomGetCharacterByName(getCurrentRoom(), 'Conscience');
      if (existingCh) {
        roomRemoveCharacter(getCurrentRoom(), existingCh);
      }

      roomAddCharacter(getCurrentRoom(), conscience);
      characterSetPos(conscience, characterGetPos(existingLeader));
    }
  }
};

export const battleV2ChangeStatusEffectValue = (
  chName: string,
  statusEffectName: string,
  value: number
) => {
  const battle = getCurrentBattle();
  if (!battle) {
    console.error('Could not find current battle');
    return;
  }
  const p = battle.participants.find(p => p.ch.name === chName);
  if (!p) {
    console.error('Could not find battle participant with name: ' + chName);
    return;
  }
  const statusEffectType =
    BattleV2StatusEffectType[
      statusEffectName as keyof typeof BattleV2StatusEffectType
    ];
  if (!statusEffectType) {
    console.error(
      'Could not find status effect type with name: ' + statusEffectName
    );
    return;
  }
  value = undefNaN(value);
  if (value === undefined) {
    console.error('Value is not a number');
    return;
  }

  battleV2ParticipantAddAutomation(
    p,
    new BattleV2AsyncAutomation(
      new UpdateStatusEffectValue(p, statusEffectType, value),
      0
    )
  );
};

export const battleV2RestoreAnimationState = (chName: string) => {
  const battle = getCurrentBattle();
  if (!battle) {
    console.error('Could not find current battle');
    return;
  }
  const p = battle.participants.find(p => p.ch.name === chName);
  if (!p) {
    console.error('Could not find battle participant with name: ' + chName);
    return;
  }
  characterSetAnimationState(
    p.ch,
    battleV2CharacterGetAnimDefs(p.bCh).getDefault()
  );
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
  setUnskippableConversation,
  setConversationGroup,
  replaceConversationMember2,
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
  setPartyAtFormation,
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
  showStore,
  setBattlePaused,
  equipWeaponOrArmor,
  pauseOverworld,
  unpauseOverworld,
  setAiState,
  startQuest,
  startQuestQuiet,
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
  setRoomTileLayer,
  swapTileLayerTileAtMarker,
  lockCamera,
  unlockCamera,

  forceSetUpdateKeysEnabled,
  floor1TutToggleColorDoorsWalkToOffset,
  floor1TutToggleColorDoors,
  changeLeader,
  battleV2ChangeStatusEffectValue,
  battleV2RestoreAnimationState,
};

// DEBUG
(window as any).commands = commands;

export default commands;
