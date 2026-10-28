import { Animation, createAnimationBuilder } from 'model/animation';
import { loadImageAsSpritesheet, SpriteModification } from 'model/sprite';
import { loadSound, setMusicMetadata, SoundType } from 'model/sound';
import { setSoundLoop, shouldUseZip } from 'model/generics';
import { isDevelopmentMode } from 'utils';
import { getResPath } from 'env';
import {
  CACHE_APP_IMAGES_ZIP_HASH_KEY,
  CACHE_APP_IMAGES_ZIP_KEY,
  externalLSGetItem,
  externalLSSetItem,
} from './save-management';
import { destroyCanvas } from 'model/canvas';
import { disableConsole, enableConsole } from 'view/console';

const getJSZip = () => {
  return (window as any).JSZip;
};

const zipImages = {};
const zipAudio = {};

class AssetLoader {
  async processAssetFile(text: string): Promise<void> {
    const loadCbs = [] as any[];
    const _Sound = async function (line: any) {
      const [, soundName, soundUrl, volumeModifierStr] = line;
      let volumeModifier = parseFloat(volumeModifierStr);
      if (isNaN(volumeModifier)) {
        volumeModifier = 1;
      }
      return loadSound(
        soundName,
        soundUrl,
        SoundType.NORMAL,
        volumeModifier,
        true
      );
    };

    const _Music = async function (line: any) {
      const [, soundName, soundUrl, volumeModifierStr] = line;
      let volumeModifier = parseFloat(volumeModifierStr);
      if (isNaN(volumeModifier)) {
        volumeModifier = 1;
      }
      // return this to wait for music to load before starting
      setMusicMetadata(soundName, soundUrl);
      // return loadSound(soundName, soundUrl, SoundType.MUSIC, volumeModifier);
      return Promise.resolve();
    };

    const _Picture = async function (line: any) {
      const [, pictureName, url, spriteWidth, spriteHeight] = line;
      if (pictureName === 'invisible') {
        return;
      }
      // console.log('LOAD IMAGE', url);
      const img = await loadImageAsSpritesheet(
        url,
        pictureName,
        Number(spriteWidth),
        Number(spriteHeight)
      );
      return img;
    };

    const _Animation = function (line: any, currentAnim: any) {
      const animName = line[1];
      const loop = line[2].trim();
      currentAnim.name = animName;
      currentAnim.loop = loop.indexOf('true') >= 0;
    };

    const _AnimSprite = function (line: any, currentAnim: Animation) {
      const spriteName = line[1];
      const ms = parseFloat(line[2]);

      currentAnim.addSprite({
        name: spriteName,
        duration: ms,
      });
    };

    const res = text.split('\n');
    let currentAnim = new Animation(false);

    const _FinalizeCurrentAnimation = function () {
      createAnimationBuilder(
        currentAnim.name,
        function (animTemplate: Animation) {
          const a = new Animation(animTemplate.loop);
          animTemplate.sprites.forEach(obj => {
            a.addSprite({
              name: obj.name,
              duration: obj.duration,
              opacity: obj.opacity,
              offsetX: obj.offsetX,
              offsetY: obj.offsetY,
            });
          });
          return a;
        }.bind(this, currentAnim)
      );

      // flipped variant
      createAnimationBuilder(
        currentAnim.name + SpriteModification.FLIPPED,
        function (animTemplate: Animation) {
          const a = new Animation(animTemplate.loop);
          animTemplate.sprites.forEach(obj => {
            a.addSprite({
              name: obj.name + SpriteModification.FLIPPED,
              duration: obj.duration,
              opacity: obj.opacity,
              offsetX: obj.offsetX,
              offsetY: obj.offsetY,
            });
          });
          return a;
        }.bind(this, currentAnim)
      );
    };

    for (const lineArr of res) {
      const line = lineArr.split(',');
      const [type] = line;

      if (type === 'AnimSprite') {
        if (!currentAnim) {
          console.error(`Error reading res.txt, AnimSprite without Anim`, line);
          throw new Error('display loading error');
        }
        _AnimSprite(line, currentAnim);
        continue;
      }

      if (currentAnim) {
        _FinalizeCurrentAnimation();
      }

      switch (type) {
        case 'Picture': {
          loadCbs.push(() => _Picture(line));
          break;
        }
        case 'Animation': {
          currentAnim = new Animation(false);
          _Animation(line, currentAnim);
          continue;
        }
        case 'Sound': {
          loadCbs.push(() => _Sound(line));
          break;
        }
        case 'Music': {
          loadCbs.push(() => _Music(line));
          break;
        }
      }
    }

    if (currentAnim) {
      _FinalizeCurrentAnimation();
    }

    for (let i = 0; i < loadCbs.length; i++) {
      await loadCbs[i]();
    }
  }

  async loadAssets(res: string): Promise<void> {
    await this.processAssetFile(res);
  }
}

export const loadRes = async (loadingTick?: () => void) => {
  const PATH_PREFIX = `${getResPath()}`;

  console.time('txt');
  const [text, foley, bg, songLoop] = await Promise.all([
    fetch(PATH_PREFIX + 'res.txt').then(resp => resp.text()),
    fetch(PATH_PREFIX + 'res-foley.txt').then(resp => resp.text()),
    fetch(PATH_PREFIX + 'res-bg.txt').then(resp => resp.text()),
    fetch(PATH_PREFIX + 'snd/songLoop.txt').then(resp => resp.json()),
  ]);
  console.timeEnd('txt');

  setSoundLoop(songLoop);

  if (loadingTick) {
    loadingTick();
  }

  if (shouldUseZip()) {
    console.time('images-zip');
    const md5 = await (await fetch(PATH_PREFIX + 'images.zip.md5')).text();
    const localMd5 = await externalLSGetItem(CACHE_APP_IMAGES_ZIP_HASH_KEY);
    const imagesArchive = await fetchZipArchive(
      PATH_PREFIX + 'images.zip',
      md5
    );
    externalLSSetItem(CACHE_APP_IMAGES_ZIP_HASH_KEY, md5);
    await processZipImagesArchiveJSZip(imagesArchive, md5 === localMd5);
    console.timeEnd('images-zip');
    // const soundsArchive = zips[1];
    // await processZipSoundArchiveJSZip(soundsArchive);
  }

  console.time('assets');
  const loader = new AssetLoader();
  // sound does not need to be loaded before starting
  loader.loadAssets(foley).then(loadingTick || function () {});

  const result = await Promise.all([
    loader.loadAssets(text).then(loadingTick || function () {}),
    loader.loadAssets(bg).then(loadingTick || function () {}),
  ]);
  console.timeEnd('assets');
  return result;
  // console.log('load res image assets');
  // await loader.loadAssets(text).then(loadingTick || function () {});
  // console.log('load res foley assets');
  // await loader.loadAssets(foley).then(loadingTick || function () {});
  // console.log('load res bg assets');
  // await loader.loadAssets(bg).then(loadingTick || function () {});
};

const processZipImagesArchiveJSZip = async (
  imagesArchive,
  useCache: boolean
) => {
  // const zipCache

  const loadZipBlobForImage = async (cacheKey: string, zip: any) => {
    const blob = new Blob([await zip.async('arraybuffer')], {
      type: 'image/png',
    });
    return blob;
  };

  console.log('Process zip images, use cache: ', useCache);

  return Promise.all(
    Object.keys(imagesArchive.files).map(async imageName => {
      const zip = imagesArchive.files[imageName];
      const cacheKey = CACHE_APP_IMAGES_ZIP_HASH_KEY + '-' + imageName;

      // I would like to use an actual blob here, but there's an intermittent error
      // where using the blob causes the creation of certain flipped sprites to be completely
      // blank.  This can be reproduced by saving a blob instead of data urls in index db,
      // reloading the page, then opening the menu to view character portraits.  There is
      // some percent chance that these portraits do not appear due to the bug.
      let imgData = '';
      let blob: Blob | null = null;
      if (useCache) {
        imgData = await externalLSGetItem(cacheKey);
      }
      if (!imgData) {
        blob = await loadZipBlobForImage(cacheKey, zip);
        imgData = URL.createObjectURL(blob);
      }
      const image = document.createElement('img');
      zipImages[imageName] = image;
      image.onload = () => {
        if (!useCache) {
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(image, 0, 0);

            const dataURL = canvas.toDataURL('image/png');
            externalLSSetItem(cacheKey, dataURL);
          }
          destroyCanvas(canvas);
          if (blob) {
            URL.revokeObjectURL(imgData);
          }
        }
      };
      image.src = imgData;
    })
  ).catch(e => {
    console.error('Failed to fetch images archive', e);
  });
};

// probably don't need this, but it's fine to have for justin
// const processZipSoundArchiveJSZip = async soundsArchive => {
//   return Promise.all(
//     Object.keys(soundsArchive.files).map(async soundName => {
//       const zip = soundsArchive.files[soundName];
//       const blob = new Blob([await zip.async('arraybuffer')], {
//         type: 'audio/mpeg',
//       });
//       const soundData = URL.createObjectURL(blob);
//       const audio = new Audio(soundData);
//       audio.autoplay = false;
//       zipAudio[soundName] = audio;
//     })
//   ).catch(e => {
//     console.error('Failed to fetch sounds archive', e);
//   });
// };

const fetchZipArchive = async (url: string, md5OfUrl: string) => {
  const localMd5 = await externalLSGetItem(CACHE_APP_IMAGES_ZIP_HASH_KEY);
  if (md5OfUrl === localMd5) {
    const localZipData = await externalLSGetItem(CACHE_APP_IMAGES_ZIP_KEY);
    if (localZipData) {
      console.log('using local zip data');
      const zip: any = await getJSZip().loadAsync(localZipData);
      return zip;
    }
  }

  console.log('loading external zip data');
  const zip: any = await fetch(url, {
    headers: {
      Accept: 'application/zip, application/octet-stream, */*',
    },
  })
    .then(function (response) {
      if (response.status === 200 || response.status === 0) {
        return Promise.resolve(response.blob());
      } else {
        return Promise.reject(new Error(response.statusText));
      }
    })
    .then(blob => {
      externalLSSetItem(CACHE_APP_IMAGES_ZIP_KEY, blob);
      return blob;
    })
    .then(getJSZip().loadAsync);

  return zip;
};

export const getZipImages = () => {
  return zipImages;
};

export const getZipImageData = (imageName: string): HTMLImageElement | null => {
  const imgData = zipImages[imageName];
  if (imgData) {
    return imgData;
  } else {
    return null;
  }
};

export const getZipAudioData = (audioName: string): HTMLAudioElement | null => {
  const audioData = zipAudio[audioName];
  if (audioName) {
    return audioData;
  } else {
    return null;
  }
};

interface RpgscriptCollectionEntry {
  path: string;
  contents: string;
}

interface MapCollectionEntry {
  path: string;
  contents: string;
}

export const getRpgscriptJsonCollection = async () => {
  const PATH_PREFIX = `${getResPath()}`;

  const entries: Record<string, RpgscriptCollectionEntry> = await fetch(
    isDevelopmentMode()
      ? '/rpgscript-collection'
      : PATH_PREFIX + 'rpgscript-collection.json'
  )
    .then(function (response) {
      if (response.status === 200 || response.status === 0) {
        return Promise.resolve(response.json());
      } else {
        return Promise.reject(new Error(response.statusText));
      }
    })
    .catch(e => {
      console.error('failed to getRpgscriptJsonCollection', e);
    });
  return entries;
};

export const getMapJsonCollection = async () => {
  const PATH_PREFIX = `${getResPath()}`;
  const fetchUrl = isDevelopmentMode()
    ? '/map-collection'
    : PATH_PREFIX + 'map-collection.json';

  console.log('fetching map collection from', fetchUrl);

  const entries: Record<string, MapCollectionEntry> = await fetch(fetchUrl)
    .then(function (response) {
      if (response.status === 200 || response.status === 0) {
        return Promise.resolve(response.json());
      } else {
        return Promise.reject(new Error(response.statusText));
      }
    })
    .catch(e => {
      console.error('failed to getMapJsonCollection', e);
    });
  return entries;
};
