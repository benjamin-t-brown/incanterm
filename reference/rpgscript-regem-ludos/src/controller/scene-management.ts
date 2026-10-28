import {
  Conditional,
  parseSingleScript,
  TriggerType,
  formatArgs,
  getScript,
  getTrigger,
  CommandWithBlock,
  ScriptParser,
  Script,
  Trigger,
  triggerExists,
} from 'lib/rpgscript';
import {
  Scene,
  sceneAddPostSceneCallback,
  sceneIsWaiting,
  sceneReplaceTemplateStrings,
  sceneSetStorage,
} from 'model/scene';
import {
  getCurrentPlayer,
  getCurrentRoom,
  getCurrentScene,
} from 'model/generics';
import {
  Prop,
  Room,
  TriggerActivator,
  roomGetCharacterByName,
  roomHasCharacter,
} from 'model/room';
import sceneCommands, {
  setStorage,
  offsetCharacter,
  setFacing,
} from 'controller/scene/scene-commands';
import sceneCommandsSkip from 'controller/scene/scene-commands-skip';
import { playerHasItem } from 'model/player';
import { getIfExists as getCharacterTemplate } from '_db/characters';
import { getUiInterface } from 'view/ui';
import { AppSection } from 'model/store';
import ConditionalFuncs from './scene/scene-conditionals';
import { get, set, timeoutPromise } from 'utils';
import { Character, Facing } from 'model/character-type';
import { Overworld } from 'model/overworld';
import { createPropRenderObject } from 'model/render-object';

// if you increase this, you have to change the arg matcher to check for the length
// of the integer string (number of decimal places) rather than just assuming it's 1
const MAX_ARGS = 10;
const argRegex = /\[ARG\d\]/;
const mapGetSceneArgs = function (
  isDialogCommand: boolean,
  scope: Record<string, any>,
  arg: string | number | object
) {
  if (typeof arg === 'string') {
    if (arg === '') {
      return '';
    }
    let match: any;
    while ((match = arg.match(argRegex))) {
      const argKey = arg.slice(match.index + 1, match.index + 5);
      const val = get(scope, argKey);
      arg = arg.slice(0, match.index) + val + arg.slice(match.index + 6);
    }
    let argRet: boolean | string | undefined = arg;

    if (!isDialogCommand) {
      // HACK replace '--' with '+' so negative negative numbers parse as positive
      argRet = arg.replace(/--/g, '+');
    }
    if (argRet === 'true') {
      argRet = true;
    } else if (argRet === 'false') {
      argRet = false;
    }

    if (typeof argRet === 'boolean') {
      return argRet;
    }
    if (argRet !== '' && !isNaN(Number(argRet))) {
      return Number(argRet);
    }
    return sceneReplaceTemplateStrings(getCurrentScene(), argRet);
  } else {
    return arg;
  }
};

export const updateScene = (scene: Scene): void => {
  if (scene.currentScript && !sceneIsWaiting(scene)) {
    let cmd: CommandWithBlock | null = null;
    while ((cmd = scene.currentScript.getNextCommand()) !== null) {
      if (cmd.block.conditionalResult === undefined) {
        const prevOnceKeysToCommit = scene.onceKeysToCommit.slice();
        cmd.block.conditionalResult = evalCondition(
          scene,
          cmd.conditional,
          undefined,
          undefined,
          cmd.i
        );
        // If any part of this conditional isn't true, then no `once` keys should
        // be marked as committed, otherwise combo `once` isn't possible
        if (!cmd.block.conditionalResult) {
          scene.onceKeysToCommit = prevOnceKeysToCommit;
        }

        // this is useful for debugging rpgscript logic
        // console.log(
        //   'EVAL',
        //   cmd.i,
        //   cmd.type,
        //   cmd.conditional,
        //   cmd.block.conditionalResult,
        //   cmd
        //   // JSON.stringify(cmd, null, 2)
        // );
      } else {
        // console.log(
        //   'command is part of the same block, continuing',
        //   cmd.type,
        //   cmd.i
        // );
      }
      if (cmd.block.conditionalResult) {
        const commands = getSceneCommands(scene);
        const commandFunction = commands[cmd.type];
        if (!commandFunction) {
          throw new Error(
            `Script runtime error.  No command exists with name '${cmd.type}'`
          );
        }

        const commandArgs: any[] = cmd?.args.map(
          mapGetSceneArgs.bind(null, cmd.type === 'playDialogue', scene.storage)
        );

        setSceneForCommands(scene);
        // console.log(
        //   'cmd',
        //   cmd.type,
        //   JSON.stringify(cmd.args),
        //   // JSON.stringify(cmd, null, 2),
        //   JSON.stringify(commandArgs)
        // );
        // console.log(
        //   'cmd',
        //   JSON.stringify(cmd, null, 2),
        //   JSON.stringify(commandArgs)
        // );
        const shouldBreak = commandFunction(...commandArgs);
        if (scene.currentScript?.isBreak()) {
          // console.log('BREAK', cmd);
          cmd = null;
          break;
        }
        if (shouldBreak) {
          break;
        }
      }
    }
    if (cmd === null) {
      // console.log(
      //   `Completed Script '${scene.currentScript.name}' stackLength='${scene.scriptStack.length}'`
      // );
      if (scene.onScriptCompleted) {
        // the resolve for this will only happen on next tick...
        scene.onScriptCompleted();
      }
      if (scene.scriptStack.length) {
        const obj = scene.scriptStack.shift();
        if (obj) {
          const { script, onScriptCompleted, args } = obj;
          scene.currentScript = script;
          scene.onScriptCompleted = onScriptCompleted;
          for (let i = 0; i < MAX_ARGS; i++) {
            const arg = args[i];
            const key = 'ARG' + i;
            if (arg === undefined || arg === 'undefined') {
              // TODO fix this with a delete that uses the '.' separated path
              delete scene.storage[key];
            } else {
              setStorage(key, arg);
            }
          }
          scene.onceKeysToCommit.forEach(arg => {
            scene.storageOnceKeys[arg] = true;
          });
          scene.onceKeysToCommit = obj.onceKeysToCommit;

          // Does the next script need to be next tick?
          if (scene.breakNextScriptCompletion) {
            scene.breakNextScriptCompletion = false;
            setTimeout(() => updateScene(scene));
          } else {
            updateScene(scene);
          }
        }
      } else {
        scene.skip = false;
        scene.currentScript = null;
        scene.currentTrigger = null;
        scene.currentTriggerType = null;
        scene.notificationsToShow = [];
        scene.onceKeysToCommit.forEach(arg => {
          scene.storageOnceKeys[arg] = true;
        });
        scene.onceKeysToCommit = [];
        scene.postSceneCallbacks.forEach(cb => {
          cb();
        });
        scene.postSceneCallbacks = [];
      }
    }
  } else if (!scene.currentScript && !sceneIsWaiting(scene)) {
  }
};

export const evalCondition = (
  scene: Scene,
  conditional?: Conditional | boolean,
  dontTriggerOnce?: boolean,
  triggerType?: TriggerType,
  scriptCallIndex?: number
): boolean => {
  // useful for debugging conditional logic in rpgscripts
  // console.log(
  //   'eval conditional',
  //   JSON.stringify(conditional, null, 2),
  //   dontTriggerOnce,
  //   triggerType
  // );
  if (conditional === true) {
    return true;
  } else if (typeof conditional === 'object') {
    const { type, args: originalArgs } = conditional;
    const args = formatArgs(originalArgs)
      .map(mapGetSceneArgs.bind(null, false, scene.storage))
      .map(arg => {
        if (typeof arg === 'object') {
          return arg;
        }
        const a = arg;
        if (typeof a === 'string' && a.search(/[a-zA-Z\d]\.[a-zA-Z\d]/) > -1) {
          if (type === 'is' || type === 'isnot') {
            return arg;
          }
          const [a, b] = (arg as string).split('.');
          if (a === 'storage') {
            return get(scene.storage, b);
          }
          if (!get(scene.storage, a)) {
            console.error('No storage in scene called:', a);
            return false;
          }
          return get(scene.storage, arg as string);
        } else {
          return arg;
        }
      });

    if (type === 'is') {
      // if the arg is a character name
      if (getCharacterTemplate(args[0])) {
        const b = Boolean(roomGetCharacterByName(getCurrentRoom(), args[0]));
        // console.log(
        //   'EVAL "is" condition (Room Has Character):',
        //   args,
        //   args[0],
        //   b
        // );
        // if the room has that character
        return b;
      } else if (typeof args[0] === 'boolean') {
        // console.log('EVAL "is" condition (Is a boolean):', args, args[0]);
        return args[0];
      }

      const b = !!get(scene.storage, args[0]);
      // console.log(
      //   'EVAL "is" condition:',
      //   args[0],
      //   get(scene.storage, args[0]),
      //   b
      // );
      return b;
    } else if (type === 'isnot') {
      if (typeof args[0] == 'object') {
        const b = !evalCondition(
          scene,
          args[0],
          dontTriggerOnce,
          triggerType,
          scriptCallIndex
        );
        // console.log('EVAL "isnot" condition (Is an Object):', args, args[0], b);
        return b;
      } else if (typeof args[0] === 'boolean') {
        // console.log('EVAL "isnot" condition (Is a boolean):', args, !args[0]);
        return !args[0];
      } else {
        // if the arg is a character name
        if (getCharacterTemplate(args[0])) {
          const b = Boolean(roomGetCharacterByName(getCurrentRoom(), args[0]));
          // console.log(
          //   'EVAL "isnot" condition (Room Has Character):',
          //   args,
          //   args[0],
          //   !b
          // );
          // if the room does not have that character
          return !b;
        }

        const b = !get(scene.storage, args[0]);
        // console.log(
        //   'EVAL "isnot" condition:',
        //   args,
        //   get(scene.storage, args[0]),
        //   b
        // );
        return b;
      }
    } else if (type === 'gt') {
      if (typeof args[0] === 'string') {
        args[0] = get(scene.storage, args[0]);
      }
      if (typeof args[1] === 'string') {
        args[1] = get(scene.storage, args[1]);
      }
      return args[0] > args[1];
    } else if (type === 'lt') {
      if (typeof args[0] === 'string') {
        args[0] = get(scene.storage, args[0]);
      }
      if (typeof args[1] === 'string') {
        args[1] = get(scene.storage, args[1]);
      }
      return args[0] < args[1];
    } else if (type === 'eq') {
      const conditions = [
        args[0] === args[1],
        get(scene.storage, args[0]) === args[1] &&
          args[0] !== undefined &&
          args[1] !== undefined,
        get(scene.storage, args[1]) === args[0] &&
          args[0] !== undefined &&
          args[1] !== undefined,
      ];
      if (typeof args[1] !== 'number') {
        const c1 = get(scene.storage, args[0]);
        const c2 = get(scene.storage, args[1]);
        if (c1 !== undefined && c2 !== undefined) {
          conditions.push(
            get(scene.storage, args[0]) === get(scene.storage, args[1])
          );
        }
      }

      // console.log(
      //   'EVAL "eq" condition:',
      //   args,
      //   get(scene.storage, args[0]),
      //   get(scene.storage, args[1]),
      //   conditions
      // );

      return conditions.reduce((prev, curr) => {
        return curr || prev;
      }, false);
    } else if (type === 'any') {
      // console.log('EVAL "any" condition:', args);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (
          evalCondition(
            scene,
            arg,
            dontTriggerOnce,
            triggerType,
            scriptCallIndex
          )
        ) {
          // console.log('Arg was true', arg);
          return true;
        }
      }
      return false;
    } else if (type === 'all') {
      // console.log('EVAL "all" condition', args);
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        // console.log(` EVAL "all" condition i=${i}`, arg);
        if (
          !evalCondition(
            scene,
            arg,
            dontTriggerOnce,
            triggerType,
            scriptCallIndex
          )
        ) {
          // console.log(` "all" condition i=${i} is false`, arg);
          return false;
        } else {
          // console.log(` "all" condition i=${i} is true`, arg);
        }
      }
      // console.log('- "all" condition is true');
      return true;
    } else if (type === 'as') {
      console.error('conditional "as" is not defined for this scene.');
      return false;
    } else if (type === 'once') {
      let arg =
        args[0] ??
        (scene.currentScript || scene.currentTrigger)?.name + '-once';

      if (!arg[0]) {
        if (scene.currentScript) {
          arg = scene.currentScript.name + scriptCallIndex + '-once';
        } else if (scene.currentTrigger) {
          arg = scene.currentTrigger.name + scriptCallIndex + '-once';
        }
      }
      if (triggerType) {
        arg =
          args[0] ??
          (scene.currentScript || scene.currentTrigger)?.name +
            '-' +
            triggerType +
            scriptCallIndex +
            '-once';
      }
      // console.log('once arg', arg);
      if (scene.storageOnceKeys[arg]) {
        return false;
      }
      if (!dontTriggerOnce) {
        scene.onceKeysToCommit.push(arg);
        // scene.storageOnceKeys[arg] = true;
      }

      return true;
    } else if (type === 'oncePerInstance') {
      const triggerId =
        (scene.currentTriggerActivator?.id ?? 'undefined_trigger_id') +
        '+' +
        getCurrentRoom().name;

      let arg =
        args[0] ??
        (scene.currentScript || scene.currentTrigger)?.name +
          '-' +
          triggerId +
          '-once';

      if (!arg[0]) {
        if (scene.currentScript) {
          arg = scene.currentScript.name + scriptCallIndex + '-once';
        } else if (scene.currentTrigger) {
          arg = scene.currentTrigger.name + scriptCallIndex + '-once';
        }
      }
      if (triggerType) {
        if (args[0]) {
          arg = args[0] + '-' + triggerId;
        } else {
          arg =
            (scene.currentScript || scene.currentTrigger)?.name +
            '-' +
            triggerType +
            scriptCallIndex +
            '-' +
            triggerId +
            '-once';
        }
      }

      if (scene.storageOnceKeys[arg]) {
        return false;
      }
      if (!dontTriggerOnce) {
        scene.onceKeysToCommit.push(arg);
        // scene.storageOnceKeys[arg] = true;
      }

      return true;
    } else if (type === 'with') {
      const itemName = args[0] ?? '';
      const player = getCurrentPlayer();
      const b = itemName && playerHasItem(player, itemName);

      console.log('EVAL "with" condition', itemName, b);
      return b;
    } else if (type === 'func') {
      const funcName = args[0] ?? '';

      const restArgs = args.slice(1);
      const func = ConditionalFuncs[funcName];

      if (!func) {
        console.error(
          'Error in conditional.  func condition is not registered: ' +
            funcName,
          args
        );
        return false;
      }

      return func(...restArgs);
    }
    return false;
  }

  return false;
};

export const invokeTrigger = (
  scene: Scene,
  triggerName: string,
  type: TriggerType,
  options?: {
    dontTriggerOnce?: boolean;
    ignoreCurrentScript?: boolean;
    triggerActivator?: TriggerActivator;
  }
): null | {
  scriptName: string;
  scriptCaller: () => Promise<void>;
} => {
  const {
    dontTriggerOnce,
    ignoreCurrentScript,
    triggerActivator: ta,
  } = options ?? {};
  // HACK allows usage of 'loot#<itemName>' in triggers without having to define the
  // trigger in rpgscript.  This could be useful for other cases, but I haven't come
  // across them yet.
  let trigger: Trigger | undefined;
  if (triggerName.includes('loot#')) {
    const src = `
#lootItem
action,?oncePerInstance():acquireLoot("${triggerName.slice(5)}")
action,noLoot
    `;
    trigger = parseSingleScript(src, scene).triggers.lootItem;
  } else {
    if (triggerExists(triggerName)) {
      trigger = getTrigger(triggerName);
    }
  }
  // const canDebugLog = type !== 'step' && type !== 'step-first';
  // if (call
  if (trigger && (ignoreCurrentScript || !scene.currentScript)) {
    // canDebugLog && console.log('INVOKE TRIGGER', triggerName, type, trigger);
    for (let i = 0; i < trigger.scriptCalls.length; i++) {
      const scriptCall = trigger.scriptCalls[i];
      // canDebugLog && console.log('check script call', scriptCall, type);
      if (scriptCall.type === type) {
        scene.currentTrigger = trigger;
        scene.currentTriggerType = type;

        const prevOnceKeysToCommit = scene.onceKeysToCommit.slice();

        const c = evalCondition(
          scene,
          scriptCall.condition,
          dontTriggerOnce,
          type,
          i
        );
        // type !== 'step' &&
        //   type !== 'step-first' &&
        //   !dontTriggerOnce &&
        //   console.log(
        //     'EVAL INVOKE CONDITION',
        //     type,
        //     scriptCall.condition,
        //     c,
        //     scriptCall
        //   );

        if (c) {
          let scriptName = ':' + scriptCall.scriptName;
          // HACK artificially insert parens for script calls by checking for the existence of opening paren.
          // obviously if there's a typo with one open paren you'll see an unfortunately obtuse error.
          if (!scriptName.includes('(')) {
            scriptName += '()';
          }
          return {
            scriptName,
            scriptCaller: async () => {
              // this allows triggers to specify arguments for script calls
              const parser = new ScriptParser('InvokeTrigger');

              // this sets the trigger's position as a variable in the scene, or zeroes it
              // out if a trigger is called without an activator
              if (ta) {
                sceneSetStorage(scene, 'vars.triggerActivator.x', ta.x);
                sceneSetStorage(scene, 'vars.triggerActivator.y', ta.y);
              } else {
                sceneSetStorage(scene, 'vars.triggerActivator.x', 0);
                sceneSetStorage(scene, 'vars.triggerActivator.y', 0);
              }

              const cmd = parser.parseCommand(scriptName, -1);
              await callScript(
                scene,
                cmd.args[0] as string, // arg0 is a scriptCall command with the name of the command
                ...cmd.args.slice(1) // arg1-n is all the arguments to the command
              );
              // this causes a lot of bloat in the save file and I don't think it's necessary
              // scene.storage[trigger.name] = true;
              scene.currentTrigger = null;
              scene.currentTriggerType = null;
            },
          };
        } else {
          // canDebugLog && console.log('skip cuz condition');
          // Prevent once keys from saving if the trigger should not be invoked
          scene.onceKeysToCommit = prevOnceKeysToCommit;
          scene.currentTrigger = null;
          scene.currentTriggerType = null;
        }
      }
    }
  }
  return null;
};

export const callScript = ((window as any).callScript = async (
  scene: Scene,
  scriptOrScriptName: string | Script,
  ...args: any[]
) => {
  // console.log('Call Script', JSON.stringify(scriptOrScriptName, null, 2));
  return new Promise<void>(resolve => {
    const script =
      typeof scriptOrScriptName === 'string'
        ? getScript(scriptOrScriptName)
        : scriptOrScriptName;
    script.reset();
    if (scene.currentScript) {
      const currentArgs: any[] = [];
      for (let i = 0; i < MAX_ARGS; i++) {
        const arg = get(scene.storage, 'ARG' + i);
        if (arg !== undefined && arg !== 'undefined') {
          currentArgs.push(arg);
        }
      }

      scene.scriptStack.unshift({
        script: scene.currentScript,
        onScriptCompleted: scene.onScriptCompleted,
        onceKeysToCommit: scene.onceKeysToCommit,
        args: currentArgs,
      });
      scene.onceKeysToCommit = [];
    }
    scene.currentScript = script;
    scene.onScriptCompleted = resolve;
    for (let i = 0; i < MAX_ARGS; i++) {
      const arg = args[i];
      const key = 'ARG' + i;
      if (arg === undefined || arg === 'undefined') {
        // TODO replace delete with recursive delete
        delete scene.storage[key];
      } else {
        setStorage(key, arg);
      }
    }
    updateScene(scene);
  });
});

export const createAndCallScript = (
  scene: Scene,
  src: string,
  ...args: any[]
) => {
  src = '@tmp\n' + src;
  const scripts = parseSingleScript(src, scene).scripts;
  const script = scripts.tmp;
  return callScript(scene, script, ...args);
};

export const sceneIsPlaying = (scene: Scene) => {
  return scene.currentScript || sceneIsWaiting(scene);
};

export const getSceneCommands = (scene: Scene): Record<string, any> => {
  if (scene.skip) {
    return sceneCommandsSkip;
  } else {
    return sceneCommands;
  }
};

export const skipCurrentScript = (scene: Scene) => {
  console.log('Skip current script');
  return new Promise<void>(resolve => {
    const isCutsceneVisible = getUiInterface().appState.sections.includes(
      AppSection.Cutscene
    );
    const isIntroVisible = getUiInterface().appState.sections.includes(
      AppSection.Intro
    );

    if (isIntroVisible) {
      getUiInterface().appState.intro.cleanup();
    }

    if (!scene.skip && isCutsceneVisible) {
      // clearTimeout(scene.waitTimeoutId);
      scene.skip = true;
      if (scene.waitTimeoutCb) {
        const oldCb = scene.waitTimeoutCb;
        scene.waitTimeoutCb = () => {
          timeoutPromise(500).then(() => {
            oldCb();
            resolve();
          });
        };
        if (scene.waitTimeoutTimer) {
          scene.waitTimeoutTimer.forceComplete();
        }
      } else if (scene.isWaitingForTime) {
        scene.onStopWaitingForTime = () => {
          resolve();
        };
      } else {
        resolve();
      }
    } else {
      resolve();
    }
  });
};

export const sceneUtilsLookDirection = async (
  ch: Character,
  direction: Facing
) => {
  // the room can change while this is running.  Need to check if character still exists
  // in the room, otherwise there will be an (harmless) error message
  await timeoutPromise(33);
  if (roomHasCharacter(getCurrentRoom(), ch)) {
    offsetCharacter(ch.name, 0, 0, -2);
    await timeoutPromise(33);
  }
  if (roomHasCharacter(getCurrentRoom(), ch)) {
    offsetCharacter(ch.name, 0, 0, 2);
    setFacing(ch.name, direction);
  }
};

export const sceneOnCompletion = async (scene: Scene): Promise<void> => {
  return new Promise(resolve => {
    const intervalId = setInterval(() => {
      if (!scene.currentScript) {
        clearInterval(intervalId);
        resolve();
      }
    }, 16);
  });
};

export const sceneSuspend = (scene: Scene): Partial<Scene> => {
  const currentScript = scene.currentScript;
  const scriptStack = scene.scriptStack;
  const onScriptCompleted = scene.onScriptCompleted;

  const args: Record<string, any> = {};
  for (let i = 0; i < 10; i++) {
    args['ARG' + i] = scene.storage['ARG' + i];
  }

  scene.currentScript = null;
  scene.scriptStack = [];
  scene.onScriptCompleted = () => void 0;

  return {
    currentScript,
    scriptStack,
    onScriptCompleted,
    storage: args,
  };
};

export const sceneUnsuspend = (
  scene: Scene,
  suspendedScene: Partial<Scene>
) => {
  scene.currentScript = suspendedScene.currentScript ?? null;
  scene.scriptStack = suspendedScene.scriptStack ?? [];
  scene.onScriptCompleted = suspendedScene.onScriptCompleted;
  Object.assign(scene.storage, suspendedScene.storage ?? {});
};

export const sceneWaitForCompletion = async (scene: Scene) => {
  if (sceneIsPlaying(scene)) {
    return new Promise<void>(resolve => {
      sceneAddPostSceneCallback(scene, resolve);
    });
  }
};

export const scenePersistProp = (
  scene: Scene,
  overworld: Overworld,
  prop: Prop
) => {
  const propKey = 'vars.' + overworld.name + '.props.' + prop.id;
  set(scene.storage, propKey, {
    ...prop,
    ro: undefined,
  });
};

export const sceneLoadPersistedProps = (
  scene: Scene,
  overworld: Overworld,
  room: Room
) => {
  const persistedProps = get(scene.storage, `vars.${overworld.name}.props`);
  if (persistedProps) {
    for (const i in persistedProps) {
      const prop = persistedProps[i];
      if (prop) {
        room.props.push(prop);
        const ro = createPropRenderObject(prop);
        prop.ro = ro;
        room.renderObjects.push(prop.ro);
      }
    }
  }
};

let sceneForCommands: Scene | null = null;
export const setSceneForCommands = (scene: Scene) => {
  sceneForCommands = scene;
};
export const getSceneForCommands = (): Scene => {
  return (sceneForCommands as Scene) ?? getCurrentScene();
};
