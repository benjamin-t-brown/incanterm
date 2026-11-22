import { parseArgs } from 'node:util';
import { loadProjectFromArguments } from '../project/cli.js';

export async function loadLoopbackOptions(args: readonly string[]) {
  const { values } = parseArgs({
    args: [...args],
    options: {
      project: { type: 'string' },
      assets: { type: 'string' },
      scene: { type: 'string' },
      save: { type: 'string' },
    },
  });
  const { project: projectPath, assets: assetsRoot, scene: sceneId, save: savePath } = values;
  for (const [name, value] of Object.entries(values)) {
    if (value === '') throw new Error(`Missing value after --${name}`);
  }
  if (projectPath && assetsRoot) throw new Error('Use --project or --assets, not both');
  return {
    project: await loadProjectFromArguments({ projectPath, assetsRoot, remaining: [] }),
    assetsRoot,
    sceneId,
    savePath,
  };
}
