import { createAndCallScript } from 'controller/scene-management';
import { sceneCreate, sceneGetStorage, sceneSetStorage } from 'model/scene';
import { disableConsole } from 'view/console';
import { it, describe, expect, beforeEach } from 'vitest';

describe('rpgscript-parser', () => {
  beforeEach(() => {
    disableConsole();
  });

  it('can parse triple nested conditionals', async () => {
    // enableConsole();
    const script = `
+?all(is("var1"), is("var2")):{
  +setStorage("test", true);
}
+?isnot(all(is("var1"), is("var2"))):{
  +setStorage("test", false);
}
`;

    const scene = sceneCreate();
    sceneSetStorage(scene, 'var1', true);
    sceneSetStorage(scene, 'var2', true);

    await createAndCallScript(scene, script);

    expect(sceneGetStorage(scene, 'test')).toBe(true);

    sceneSetStorage(scene, 'var1', false);

    await createAndCallScript(scene, script);

    expect(sceneGetStorage(scene, 'test')).toBe(false);

    disableConsole();
  });
});
