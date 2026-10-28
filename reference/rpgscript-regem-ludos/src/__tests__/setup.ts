import initDb from '_db';
import { vi } from 'vitest';
import fs from 'fs';
import createFetchMock from 'vitest-fetch-mock';
import { initScene } from 'model/scene';
import { disableConsole, initConsole } from 'view/console';
import { init as initOverworldAi } from 'controller/overworld-ai';
import * as utilsImport from 'utils';
import * as animsImport from 'model/animation';
import * as spritesImport from 'model/sprite';
import React from 'react';
import { setupCabinets } from 'view/components/ArcadeCabinet';

vi.mock('react-i18next', () => ({
  // this mock makes sure any components using the translate hook can use it without a warning being shown
  useTranslation: () => {
    return {
      t: (str: string): string => str,
    };
  },
}));

const utils = utilsImport as any;
const sprites = spritesImport as any;
const anims = animsImport as any;

(window as any).TEST = true;

// Mock canvas context before any modules that use it are loaded
HTMLCanvasElement.prototype.getContext = (() => {
  return {
    createLinearGradient: () => ({
      addColorStop: vi.fn(),
    }),
  };
}) as any;

async function setup() {
  initConsole();
  disableConsole();

  (window as any).TEST = true;

  // vi.mock('preact/hooks', async () => ({
  //   ...(await vi.importActual<any>('preact/hooks')),
  //   useEffect: vi.fn(),
  // }));

  // vi.mock('model/sound', async () => ({
  //   ...(await vi.importActual<any>('model/sound')),
  //   playSound: vi.fn(),
  //   playSoundName: vi.fn(),
  //   playMusic: vi.fn(),
  //   updateMusic: vi.fn(),
  //   getCurrentMusic: vi.fn(),
  //   stopCurrentMusic: vi.fn(),
  // }));

  vi.spyOn(anims, 'createAnimation');
  anims.createAnimation.mockImplementation(() => {
    return new anims.Animation();
  });
  vi.spyOn(anims, 'hasAnimation');
  anims.hasAnimation.mockImplementation(() => {
    return true;
  });

  vi.spyOn(sprites, 'getSprite');
  sprites.getSprite.mockImplementation(() => {
    return [null, 0, 0, 0, 0];
  });

  vi.spyOn(sprites, 'loadImageAsSprite');
  sprites.loadImageAsSprite.mockImplementation(() => {
    return [null, 0, 0, 0, 0];
  });

  vi.spyOn(sprites, 'loadImageAsSpritesheet');
  sprites.loadImageAsSpritesheet.mockImplementation(() => {
    return [null, 0, 0, 0, 0];
  });

  vi.spyOn(utils, 'timeoutPromise');
  utils.timeoutPromise.mockImplementation((ms: number) => {
    console.log('Mock timeoutPromise', ms);
    return Promise.resolve();
  });

  vi.spyOn(utils, 'timeoutWithPromise');
  utils.timeoutWithPromise.mockImplementation((ms: number) => {
    console.log('Mock timeoutWithPromise', ms);
    return Promise.resolve();
  });

  // tests hang infinitely without this
  // vi.mock('preact/hooks', async () => {
  //   const actualHooks = await vi.importActual<any>('preact/hooks');
  //   const useEffectMock = vi.fn();
  //   setUseEffectMock(useEffectMock);
  //   return {
  //     ...actualHooks,
  //     useEffect: useEffectMock,
  //   };
  // });

  (window as any).JSZip = {
    loadAsync: vi.fn().mockImplementation(() => {
      return {
        files: [],
      };
    }),
  };

  Object.assign(navigator, {
    getGamepads: vi.fn().mockImplementation(() => {
      return [];
    }),
  });

  const fetchMock = createFetchMock(vi);
  fetchMock.enableMocks();
  fetchMock.mockResponse(async req => {
    let respText = '';

    let url = req.url.replace('/regem-ludos/', '/').slice('http://'.length);
    url = url.slice(url.indexOf('/'));

    try {
      if (/rpgscript/.test(url)) {
        const rpgscriptPath = __dirname + '/../../src' + url;
        respText = fs.readFileSync(rpgscriptPath).toString();
      }
      if (/^\/map-collection|map-collection\.json/.test(url)) {
        const mapPath = __dirname + '/../../res/map-collection.json';
        respText = fs.readFileSync(mapPath).toString();
      }
      if (/\/map\//.test(url)) {
        const mapPath = __dirname + '/../../res' + url;
        respText = fs.readFileSync(mapPath).toString();
      }
      if (/res.txt/.test(url)) {
        const resPath = __dirname + '/../../' + url;
        respText = fs.readFileSync(resPath).toString();
      }
    } catch (e) {
      console.error('Error during mock fetching', url, e);
    }

    return respText;
  });

  vi.mock('react', async () => {
    const actualHooks = await vi.importActual<any>('react');
    const useEffectMock = vi.fn();
    return {
      ...actualHooks,
      useEffect: useEffectMock,
    };
  });
  vi.spyOn(React, 'useEffect');
  initOverworldAi();
  initScene();
  setupCabinets();
  await initDb();
}

setup();
