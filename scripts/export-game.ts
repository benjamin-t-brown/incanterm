import { exportGame } from '../src/export/export-game.js';
import { parseExportArguments } from '../src/export/export-options.js';

try {
  if (process.argv.slice(2).includes('--help')) {
    console.log(
      'Usage: npm run export-game -- --project <folder> --out <new-directory> [--scene <id-or-label>]',
    );
  } else {
    const release = await exportGame(parseExportArguments(process.argv.slice(2)));
    console.log(`Exported game to ${release.outputPath}`);
    console.log(`Entry scene: ${release.entryScene}`);
    console.log('Deploy this directory with Node.js 22+ or build its Dockerfile.');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
