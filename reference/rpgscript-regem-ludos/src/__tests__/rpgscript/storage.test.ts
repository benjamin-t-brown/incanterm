import { createAndCallScript } from 'controller/scene-management';
import { sceneCreate, sceneGetStorage, sceneSetStorage } from 'model/scene';
import { disableConsole } from 'view/console';
import { it, describe, expect, afterEach } from 'vitest';

describe('rpgscript-storage', () => {
  afterEach(() => {
    disableConsole();
  });

  it('setStorage with false behaves correctly', async () => {
    const script = `
+setStorage("test", false);
`;
    const scene = sceneCreate();
    await createAndCallScript(scene, script);
    expect(sceneGetStorage(scene, 'test')).toStrictEqual(false);

    sceneSetStorage(scene, 'var.var.var.var5', false);
    expect(sceneGetStorage(scene, 'var.var.var.var5')).toStrictEqual(false);
  });

  it('setStorage with empty string behaves correctly', async () => {
    // enableConsole();
    const script = `
+setStorage("test", '');
`;

    const scene = sceneCreate();
    sceneSetStorage(scene, 'test', undefined);
    await createAndCallScript(scene, script);
    expect(sceneGetStorage(scene, 'test')).toStrictEqual('');
  });
});
