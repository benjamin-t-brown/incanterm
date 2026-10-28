/**
 * This file provides a function that reads all the rpgscript files in the src/rpgscript
 * directory and returns a large json file containing all their contents mapped to their
 * filenames.  This allows consumers of rpgscript files to load a single json file
 * instead of all the individual script files, which decreases network latency.
 */

const path = require('path');
const fs = require('fs');

const logInfo = (...args) => {
  console.log('[get-rpgscript-collection]', ...args);
};

const logError = (...args) => {
  console.error('[get-rpgscript-collection]', ...args);
};

const readDirRecursive = async filePath => {
  const dir = await fs.promises.readdir(filePath);
  const files = await Promise.all(
    dir.map(async relativePath => {
      const absolutePath = path.join(filePath, relativePath);
      const stat = await fs.promises.lstat(absolutePath);

      return stat.isDirectory() ? readDirRecursive(absolutePath) : absolutePath;
    })
  );

  return files.flat();
};

const getRpgscriptCollection = async () => {
  return new Promise((resolve, reject) => {
    readDirRecursive(path.join(__dirname, '../src/rpgscript'))
      .then(files => {
        resolve(
          Promise.all(
            files.map(path => {
              return fs.promises
                .readFile(path)
                .then(contents => {
                  return {
                    path: path.slice(path.indexOf('rpgscript') + 10, -10),
                    contents: contents.toString(),
                  };
                })
                .catch(e => {
                  const msg = 'Could not load file: ' + path;
                  logError('Could not load file: ' + path, e);
                  reject(msg);
                });
            })
          )
            .then(entries => {
              return entries.reduce((rpgscriptObject, entry) => {
                rpgscriptObject[entry.path] = entry;
                return rpgscriptObject;
              }, {});
            })
            .catch(e => {
              logError('Error while reading rpgscript dir:', e);
              reject('Could not aggregate rpgscript json.');
            })
        );
      })
      .catch(e => {
        reject(e);
      });
  });
};
module.exports.getRpgscriptCollection = getRpgscriptCollection;

if (process.argv[2] === 'ci') {
  const main = async () => {
    console.log(
      JSON.stringify(
        await getRpgscriptCollection().catch(e => {
          throw e;
        })
      )
    );
  };
  main();
}
