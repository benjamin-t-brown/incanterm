import { callScript, createAndCallScript } from 'controller/scene-management';
import { parseRPGScript } from 'lib/rpgscript';
import { sceneCreate, sceneGetStorage, sceneSetStorage } from 'model/scene';
import { disableConsole, enableConsole } from 'view/console';
import { it, describe, expect, afterEach } from 'vitest';

describe('rpgscript-conditionals', () => {
  afterEach(() => {
    disableConsole();
  });

  it('correctly evaluates "is" and "isnot" blocks with storage keys in them', async () => {
    const script = `
+?is("tmp.var1"):{
  +setStorage("var1", true);
}
+?is("tmp_var2"):{
  +setStorage("var2", true);
}
+?is("tmp.var3"):{
  +setStorage("var3", true);
}
+?is("tmp.var4"):{
  +setStorage("var4", true);
}
+?isnot("tmp.var4"):{
  +setStorage("var4", false);
}
+?isnot("tmp.tmp.tmp.var5"):{
  +setStorage("var5", true);
}
`;

    const scene = sceneCreate();
    sceneSetStorage(scene, 'tmp.var1', true);
    sceneSetStorage(scene, 'tmp_var2', true);
    sceneSetStorage(scene, 'tmp.var3', 'some truthy value');
    // skip var4 to check undefined case
    // sceneSetStorage(scene, 'tmp.var4', false);
    sceneSetStorage(scene, 'tmp.tmp.tmp.var5', false);

    await createAndCallScript(scene, script);

    expect(sceneGetStorage(scene, 'var1')).toEqual(true);
    expect(sceneGetStorage(scene, 'var2')).toEqual(true);
    expect(sceneGetStorage(scene, 'var3')).toEqual(true);
    expect(sceneGetStorage(scene, 'var4')).toEqual(false);
    expect(sceneGetStorage(scene, 'var5')).toEqual(true);
  });

  it('"is" works correctly with empty strings', async () => {
    const script = `
+?is("tmp.var1"):{
  +setStorage("var1", true);
}
`;

    const scene = sceneCreate();
    sceneSetStorage(scene, 'tmp.var1', '');

    await createAndCallScript(scene, script);

    expect(sceneGetStorage(scene, 'var1')).toEqual(undefined);
  });

  it('correctly evaluates "once" when invoking two script calls', async () => {
    const script = `
@runTest
  +:incrementVarOnce()

@incrementVarOnce
  +?once():{
    +incrementStorage("var1", 1);
  }
`;

    const scene = sceneCreate();
    sceneSetStorage(scene, 'var1', 0);
    parseRPGScript('test', script, scene);

    // call the script twice, and expect the once condition to only be true once
    await callScript(scene, 'runTest');
    await callScript(scene, 'runTest');

    expect(sceneGetStorage(scene, 'var1')).toEqual(1);
  });

  it('correctly evaluates "once" when invoking two consecutive function calls', async () => {
    enableConsole();

    const script = `
@runTest
  +:incrementVarOnce()
  +:incrementVarOnce()

@incrementVarOnce
  +?once():{
    +incrementStorage("var1", 1);
  }
`;

    const scene = sceneCreate();
    sceneSetStorage(scene, 'var1', 0);
    parseRPGScript('test', script, scene);

    // call the script once, it will call incrementVarOnce twice, but the once condition should only be true once
    await callScript(scene, 'runTest');

    expect(sceneGetStorage(scene, 'var1')).toEqual(1);
  });

  it('correctly evaluates "once" when invoking multiple consecutive function calls', async () => {
    enableConsole();

    const script = `
@runTest
  +:incrementVarOnce()
  +:incrementVarOnce()
  +:incrementVarOnce()
  +:incrementVarOnce2()
  +:incrementVarOnce2()

@incrementVarOnce
  +?once():{
    +incrementStorage("var1", 1);
  }

@incrementVarOnce2
  +?once():{
    +incrementStorage("var1", 1);
  }
`;

    const scene = sceneCreate();
    sceneSetStorage(scene, 'var1', 0);
    parseRPGScript('test', script, scene);

    await callScript(scene, 'runTest');

    expect(sceneGetStorage(scene, 'var1')).toEqual(2);
  });
});
