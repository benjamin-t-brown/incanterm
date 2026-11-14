import { loadSceneByReference } from './load-scene.js';
import { parseProjectArguments, loadProjectFromArguments } from '../project/cli.js';
import { getProjectSource } from '../project/project.js';
import { CellBuffer } from './cell-buffer.js';
import { encodeTerminal, getPlainText } from './terminal.js';
import {
  LayoutStandardScene,
  STANDARD_BACKGROUND,
  STANDARD_HEIGHT,
  STANDARD_WIDTH,
} from '../renderer/ui/layout-standard-scene.js';

const options = parseProjectArguments(process.argv.slice(2));
if (options.remaining.some((argument) => argument !== '--plain'))
  throw new Error(`Unknown arguments: ${options.remaining.join(' ')}`);
const source = getProjectSource({
  project: await loadProjectFromArguments(options),
  assetsRoot: options.assetsRoot,
  sceneId: options.sceneId,
});
const scene = await loadSceneByReference(source.assetsRoot, source.sceneId);
const plain = process.argv.includes('--plain') || !process.stdout.isTTY;
const buffer = new CellBuffer(STANDARD_WIDTH, STANDARD_HEIGHT, STANDARD_BACKGROUND);
new LayoutStandardScene(scene).render(buffer);
process.stdout.write(
  plain ? `${getPlainText(buffer)}\n` : encodeTerminal(buffer, { clear: false }),
);
