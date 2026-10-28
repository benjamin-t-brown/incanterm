const path = require('path');
const fs = require('fs-extra');
const os = require('os');

const userHomeDir = os.homedir();

const mvAsync = async (src, dest) => {
  return new Promise((resolve, reject) => {
    console.log('cp', src, dest);
    fs.copy(src, dest, err => {
      if (err) {
        reject(err);
      } else {
        resolve(undefined);
      }
    });
  });
};

const OUT_DIR = userHomeDir + '/.vscode/extensions/rpgscript-vs';
const START_DIR = path.resolve(__dirname, '../');

const main = async () => {
  await mvAsync(START_DIR, OUT_DIR);
};
main();
