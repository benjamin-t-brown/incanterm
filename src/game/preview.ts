import { TEST_SCENE_ID, getDefaultAssetsRoot, loadScene } from './load-scene.js';
import { CellBuffer } from './cell-buffer.js';
import { encodeTerminal, getPlainText } from './terminal.js';
import {
  LayoutStandardScene,
  STANDARD_BACKGROUND,
  STANDARD_HEIGHT,
  STANDARD_WIDTH,
} from '../renderer/ui/layout-standard-scene.js';

const scene = await loadScene(getDefaultAssetsRoot(), TEST_SCENE_ID);
const plain = process.argv.includes('--plain') || !process.stdout.isTTY;
const buffer = new CellBuffer(STANDARD_WIDTH, STANDARD_HEIGHT, STANDARD_BACKGROUND);
new LayoutStandardScene(scene).render(buffer);
process.stdout.write(plain ? `${getPlainText(buffer)}\n` : encodeTerminal(buffer, { clear: false }));
