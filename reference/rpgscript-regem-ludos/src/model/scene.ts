import { Script, Trigger, TriggerType } from 'lib/rpgscript';
import { getSceneCommands, sceneIsPlaying } from 'controller/scene-management';
import { getIsWalkingToTalkCharacter, setCurrentScene } from 'model/generics';
import { TriggerActivator } from './room';
import { get, set } from 'utils';
import { Timer } from './utility';
import { getUiInterface } from 'view/ui';
import { AppSection } from './store';
import { Player } from './player';

interface IScriptStackItem {
  script: Script;
  onScriptCompleted?: () => void;
  onceKeysToCommit: string[];
  args: any[];
}

export enum GLOBAL_SCENE_STORAGE_VARS {
  LAST_DROPPED_PROP = 'vars.lastDroppedProp',
}

export interface Scene {
  storage: Record<string, string | boolean | number>;
  storageOnce: Record<string, string | boolean>;
  storageOnceKeys: Record<string, boolean>;
  storageEncounters: Record<string, Record<string, boolean>>;
  storageTreasure: Record<string, Record<string, boolean>>;
  onceKeysToCommit: string[];
  commands: Record<string, any>;
  currentScript: Script | null;
  currentTrigger: Trigger | null;
  currentTriggerType: TriggerType | null;
  currentTriggerActivator: TriggerActivator | null;
  scriptStack: IScriptStackItem[];
  onScriptCompleted?: () => void;
  onStopWaitingForTime?: () => void;
  isWaitingForInput: boolean;
  isWaitingForTime: boolean;
  isWaitingForAnimation: boolean;
  inputDisabled: boolean; // used only for dialog input
  waitTimeoutId: number;
  waitTimeoutCb: any;
  waitTimeoutTimer?: Timer;
  skip: boolean;
  postSceneCallbacks: (() => void)[];
  notificationsToShow: string[];
  breakNextScriptCompletion?: boolean;
}

export const sceneCreate = (): Scene => {
  const scene: Scene = {
    storage: {} as Record<string, string | boolean>,
    storageOnce: {} as Record<string, string>,
    storageOnceKeys: {} as Record<string, boolean>,
    storageEncounters: {} as Record<string, Record<string, boolean>>,
    storageTreasure: {} as Record<string, Record<string, boolean>>,
    onceKeysToCommit: [] as string[],
    commands: {} as Record<string, any>,
    currentScript: null,
    currentTrigger: null,
    currentTriggerType: null,
    currentTriggerActivator: null,
    scriptStack: [] as IScriptStackItem[],
    isWaitingForInput: false,
    isWaitingForTime: false,
    isWaitingForAnimation: false,
    inputDisabled: false,
    waitTimeoutId: -1,
    waitTimeoutCb: null,
    skip: false,
    postSceneCallbacks: [],
    notificationsToShow: [],
  };
  Object.assign(scene.commands, getSceneCommands(scene));
  return scene;
};

export const initScene = () => {
  const scene = sceneCreate();
  sceneSetStorage(scene, 'access.floor1', true);
  sceneSetStorage(scene, 'access.floor2', true);
  sceneSetStorage(scene, 'access.currentFloor', 1);
  sceneSetStorage(scene, 'vars.cardz.BlackJackCheat', true);
  sceneSetStorage(scene, 'vars.cardz.HeartsCheat', true);
  sceneSetStorage(scene, 'vars.cardz.EchoCheat', true);
  sceneSetStorage(scene, 'vars.cardz.Pachinko', true);
  sceneSetStorage(scene, 'vars.cardz.PresidentCheat', true);
  sceneSetStorage(scene, 'emotionMs', 400);
  setCurrentScene(scene);
};

export const createSubScene = (scene: Scene): Scene => {
  const scene2 = sceneCreate();
  scene2.storage = scene.storage;
  // Maybe in the future we can specify a subset of commands that can be run on SubScenes
  Object.assign(scene.commands, getSceneCommands(scene));
  return scene2;
};

export const sceneIsWaiting = (scene: Scene): boolean => {
  return (
    scene.isWaitingForInput ||
    scene.isWaitingForTime ||
    scene.isWaitingForAnimation
  );
};

export const sceneStopWaitingUntil = (scene: Scene) => {
  scene.isWaitingForTime = false;
};

export const sceneHasCommand = (scene: Scene, commandName: string): boolean => {
  const commands = sceneGetCommands(scene);
  return !!commands[commandName];
};

export const sceneGetCommands = (scene: Scene): Record<string, any> => {
  return scene.commands;
};

export const sceneSetEncounterDefeated = (
  scene: Scene,
  roamerName: string,
  overworldName: string
) => {
  overworldName = overworldName.toLowerCase();
  if (scene.storageEncounters[overworldName]) {
    scene.storageEncounters[overworldName][roamerName] = true;
  } else {
    scene.storageEncounters[overworldName] = {
      [roamerName]: true,
    } as Record<string, boolean>;
  }
};

export const sceneSetTreasureAcquired = (
  scene: Scene,
  propId: string,
  overworldName: string
) => {
  overworldName = overworldName.toLowerCase();
  if (scene.storageTreasure[overworldName]) {
    scene.storageTreasure[overworldName][propId] = true;
  } else {
    scene.storageTreasure[overworldName] = {
      [propId]: true,
    } as Record<string, boolean>;
  }
};

export const sceneIsEncounterDefeated = (
  scene: Scene,
  roamerName: string,
  overworldName: string
) => {
  overworldName = overworldName.toLowerCase();
  if (scene.storageEncounters[overworldName]) {
    return !!scene.storageEncounters[overworldName][roamerName];
  } else {
    return false;
  }
};

export const sceneHasTreasureBeenAcquired = (
  scene: Scene,
  propId: string,
  overworldName: string
) => {
  overworldName = overworldName.toLowerCase();
  if (scene.storageTreasure[overworldName]) {
    return !!scene.storageTreasure[overworldName][propId];
  } else {
    return false;
  }
};

export const sceneSetCurrentOverworld = (scene: Scene, roomName: string) => {
  scene.storage['currentOverworld'] = roomName;
};

export const sceneGetCurrentOverworldName = (scene: Scene) => {
  return scene.storage['currentOverworld'] ?? 'test2';
};

export const sceneAddPostSceneCallback = (scene: Scene, cb: () => void) => {
  scene.postSceneCallbacks.push(cb);
};

export const sceneStopWaitingForTime = (scene: Scene) => {
  scene.isWaitingForTime = false;
  if (scene.onStopWaitingForTime) {
    scene.onStopWaitingForTime();
    scene.onStopWaitingForTime = undefined;
  }
};

export const sceneReplaceTemplateStrings = (scene: Scene, text: string) => {
  text.match(/['"`]*{([\d\w.-]*)}['"`]*/g)?.forEach(matchText => {
    const path = matchText.slice(1, -1);
    const variable = get(scene.storage, path);
    // console.log('replace', matchText, variable, typeof variable);
    if (typeof variable === 'number') {
      text = text.replace(matchText, String(variable));
    } else {
      text = text.replace(matchText, variable);
    }
  });
  const asNumber = Number(text);
  if (isNaN(asNumber)) {
    return text;
  } else {
    return asNumber;
  }
};

export const sceneSetStorage = (scene: Scene, key: string, value: any) => {
  set(scene.storage, key, value);
};

export const sceneGetStorage = ((window as any).sceneGetStorage = (
  scene: Scene,
  key: string
) => {
  return get(scene.storage, key);
});

export const sceneIsControllingPlayer = (scene: Scene, player: Player) => {
  const cutsceneRunning = Boolean(
    sceneIsPlaying(scene) ||
      player.leader.walkTarget ||
      getIsWalkingToTalkCharacter() ||
      getUiInterface()?.appState.sections.includes(AppSection.ArcadeCabinet)
  );

  return cutsceneRunning;
};

export const sceneHasNotificationsToShow = (scene: Scene, text: string) => {
  return Boolean(scene.notificationsToShow.find(t => t === text));
};

export const scenePushNotificationToShow = (scene: Scene, text: string) => {
  if (!sceneHasNotificationsToShow(scene, text)) {
    scene.notificationsToShow.push(text);
  }
};
