const path = require('path');
const fs = require('fs-extra');

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

const OUT_DIR = path.resolve(__dirname, '../src/server/dist');
const START_DIR = path.resolve(__dirname, '../src/server');

const main = async () => {
  await mvAsync(START_DIR + '/src/', OUT_DIR);
};
main();
