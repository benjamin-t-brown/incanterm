import { it, describe, expect, beforeEach, afterEach } from 'vitest';
import { playerCreate } from 'model/player';
import { disableConsole, enableConsole } from 'view/console';
import { get as getCharacterTemplate } from '_db/characters';
import {
  getCurrentScene,
  setCurrentPlayer,
  setCurrentScene,
} from 'model/generics';
import { sceneCreate, sceneGetStorage } from 'model/scene';
import {
  createAndCallScript,
  getSceneCommands,
} from 'controller/scene-management';

describe('overworld-management', () => {
  beforeEach(() => {
    const scene = sceneCreate();
    setCurrentScene(scene);

    const adaTemplate = getCharacterTemplate('Ada');
    const player = playerCreate(adaTemplate);
    setCurrentPlayer(player);
    enableConsole();
  });

  afterEach(() => {
    disableConsole();
  });

  describe('sceneCommands', () => {
    it('scene commands and scene commands skip have the same object keys', () => {
      const scene = getCurrentScene();
      const commands = getSceneCommands(scene);
      scene.skip = true;
      const commandsSkip = getSceneCommands(scene);
      expect(Object.keys(commands).sort()).toEqual(
        Object.keys(commandsSkip).sort()
      );
    });

    it('can assert true expressions', async () => {
      const script = `
      +setStorage("var1", true);
      +setStorage("var2", false);
      +assert("+?eq(var1, true)");
      +setStorage("var2", true);
      `;

      const scene = sceneCreate();

      await createAndCallScript(scene, script);

      expect(sceneGetStorage(scene, 'var1')).toEqual(true);
      expect(sceneGetStorage(scene, 'var2')).toEqual(true);
    });

    it('can assert false expressions', async () => {
      const script = `
      +setStorage("var1", false);
      +setStorage("var2", false);
      +assert("+?eq(var1, true)");
      +setStorage("var2", true);
      `;

      const scene = sceneCreate();

      await createAndCallScript(scene, script);

      expect(sceneGetStorage(scene, 'var1')).toEqual(false);
      expect(sceneGetStorage(scene, 'var2')).toEqual(false);
    });

    it('can call expressions on fail', async () => {
      const script = `
      +setStorage("var1", false);
      +setStorage("var2", false);
      +setStorage("var3", false);
      +assert("+?eq(var1, true)", "+setStorage('var3', true)");
      +setStorage("var2", true);
      `;

      const scene = sceneCreate();

      await createAndCallScript(scene, script);

      expect(sceneGetStorage(scene, 'var1')).toEqual(false);
      expect(sceneGetStorage(scene, 'var2')).toEqual(false);
      expect(sceneGetStorage(scene, 'var3')).toEqual(true);
    });

    it('can sbreak correctly', async () => {
      const script = `
      +setStorage("var1", true);
      +setStorage("var2", false);
      +?is(var1):{
        +sbreak();
      }
      +setStorage("var2", true);
      `;
      const scene = sceneCreate();

      await createAndCallScript(scene, script);

      expect(sceneGetStorage(scene, 'var2')).toEqual(false);
    });

    it('can sbreak a sub script correctly', async () => {
      const script = `
      +:subscript();
      +setStorage("var3", true);

      @subscript
      +setStorage("subscript1", true);
      +sbreak();
      +setStorage("subscript2", true);
      `;
      const scene = sceneCreate();

      await createAndCallScript(scene, script);

      expect(sceneGetStorage(scene, 'var3')).toEqual(true);
      expect(sceneGetStorage(scene, 'subscript1')).toEqual(true);
      expect(sceneGetStorage(scene, 'subscript2')).toEqual(undefined);
    });
  });
});
