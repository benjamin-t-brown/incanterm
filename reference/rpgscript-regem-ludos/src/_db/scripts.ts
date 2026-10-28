import { getRpgscriptJsonCollection } from 'controller/res-loader';
import { parseRPGScript } from 'lib/rpgscript';
import { Scene } from 'model/scene';

export const init = async (scene: Scene) => {
  const scripts = [
    'test3',
    'test2',
    'test',
    'testCi',
    'example',
    'utils',
    'elevator',
    'loot',
    'credits',
    'green-pools',
    'party-members',
    'floor1/floor0-pre',
    'floor1/floor1',
    'floor1/floor1-atrium',
    'floor1/floor1-party',
    'floor2/floor2',
    'floor2/floor2-cafeteria',
    'floor2/floor2-guestrooms',
    'floor2/floor2-lockers',
    'floor2/floor2-vr-main',
    'floor3/floor3-cards',
    'floor3/floor3',
    'instances/tutorial',
    'instances/challenge-floor2',
    'instances/carl-arnold-pre',
    'instances/carl-arnold-throne',
    'instances/carl-arnold-conscience-prison',
    'instances/fortress-of-bartolo-pre',
    'instances/fortress-of-bartolo-junkyardsewer',
    'quest/quest-tic-tac-toe',
    'quest/quest-ping-pong',
    'quest/quest-rhoconn',
    'quest/quest-skye',
    'quest/quest-rps',
    'quest/quest-gobbler',
    'quest/quest-prophecy-of-lance',
    'quest/quest-puzzling-tradition',
    'quest/quest-pattern-matchmaking',
    'quest/pattern-matchmaking/mm-pairing-conversations',
    'quest/pattern-matchmaking/mm-table-1',
    'quest/pattern-matchmaking/mm-table-2',
    'quest/pattern-matchmaking/mm-table-3',
    'quest/pattern-matchmaking/mm-table-4',
    'quest/pattern-matchmaking/mm-table-5',
    'quest/pattern-matchmaking/mm-table-6',
    'quest/pattern-matchmaking/mm-table-7',
    'quest/pattern-matchmaking/mm-table-8',
    'quest/quest-jesse-date',
    'quest/quest-party-planner-assistant',
    'quest/quest-free-throw',
    'quest/quest-oeeseg',
    'intro',
    'bowling',
    'flashback/ada-room1',
    'flashback/ada-vr-conscience-intro',
    'carl-arnold-high-scores',
  ];

  console.log('Loading rpgscripts:\n', scripts.sort());
  const scriptCollection = await getRpgscriptJsonCollection();
  scripts.forEach(scriptName => {
    let obj = scriptCollection[scriptName];
    if (!obj) {
      // express will use windows line endings if it pleases and sparkles
      obj = scriptCollection[scriptName.replace(/\//g, '\\')];
    }
    if (!obj) {
      console.error(`Failed to load script from collection: "${scriptName}"`);
      return;
    }
    const { path, contents } = obj;
    parseRPGScript(path, contents, scene);
  });
  // if (isDevelopmentMode()) {
  //   const scriptCollection = await getRpgscriptJsonCollection();
  //   console.log('got collection', scriptCollection);
  //   scripts.forEach(scriptName => {
  //     const obj = scriptCollection[scriptName];
  //     if (!obj) {
  //       console.error('Failed to load script from collection: ', scriptName);
  //       return;
  //     }
  //     const { path, contents } = obj;
  //     parseRPGScript(path, contents, scene);
  //   });
  // } else {
  //   await Promise.all(
  //     scripts.map(scriptPathWithoutExtension =>
  //       loadRPGScript(getResPath(), scriptPathWithoutExtension, scene)
  //     )
  //   );
  // }
};
