import { TEST_SCENE_ID, defaultAssetsRoot, loadScene } from './load-scene.js';
import { renderView } from './scene.js';
import { encodeTerminal, plainText } from './terminal.js';

const scene = await loadScene(defaultAssetsRoot(), TEST_SCENE_ID);
const plain = process.argv.includes('--plain') || !process.stdout.isTTY;
const buffer = renderView(scene, scene.width, scene.height);
process.stdout.write(plain ? `${plainText(buffer)}\n` : encodeTerminal(buffer, { clear: false }));
