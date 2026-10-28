import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { RPGScriptParser } from './rpgscript';
import { getSceneCommands } from './commands';
import { logger } from '../logger';

const createErrorDiagnostic = (
  fileName: string,
  lineNum: number,
  severity: string,
  msg: string
) => {
  // logger.log(`${fileName}:${lineNum}--${severity}--${msg}`);
  const d: Diagnostic = {
    severity: severity.toLowerCase().includes('error')
      ? DiagnosticSeverity.Error
      : DiagnosticSeverity.Warning,
    range: {
      start: {
        line: lineNum - 1,
        character: 0,
      },
      end: {
        line: lineNum - 1,
        character: Number.MAX_VALUE,
      },
    },
    message: msg,
    source: 'RPGScript:' + fileName,
  };
  return d;
};

const checkCallScriptCommands = (
  name: string,
  parser: RPGScriptParser,
  diagnostics: Diagnostic[]
) => {
  const scripts = Object.keys(parser.getScripts());
  const callScriptStrings = parser.getCallScriptStrings();
  callScriptStrings.forEach(({ scriptName, lineNum, fileName }) => {
    if (fileName === 'linter' && !scripts.includes(scriptName)) {
      diagnostics.push(
        createErrorDiagnostic(
          name,
          lineNum,
          'Error',
          'No script exists with name "' + scriptName + '".'
        )
      );
    }
  });
};

const getAllRpgscriptFiles = (scriptsDir: string, ignoreFileName: string) => {
  const files = fs.readdirSync(scriptsDir);
  let rpgscriptFileNames: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const nextFileName = scriptsDir + '/' + files[i];

    if (files[i] === ignoreFileName) {
      continue;
    }

    const stat = fs.statSync(nextFileName);
    if (stat.isDirectory()) {
      rpgscriptFileNames = rpgscriptFileNames.concat(
        getAllRpgscriptFiles(nextFileName, ignoreFileName)
      );
    } else if (path.extname(nextFileName) === '.rpgscript') {
      rpgscriptFileNames.push(nextFileName);
    }
  }

  return rpgscriptFileNames;
};

export const lintFile = (
  filePath: string,
  scriptRoot: string,
  fileSrc: string
) => {
  const folderPath = scriptRoot;
  const parser = new RPGScriptParser({
    commands: getSceneCommands(),
  });

  const diagnostics: Diagnostic[] = [];

  // logger.log('Lint: ', filePath, folderPath);

  if (!fs.existsSync(folderPath)) {
    throw new Error('No folder exists with name: ' + folderPath);
  }

  if (!fs.existsSync(filePath)) {
    throw new Error('No file exists with name: ' + filePath);
  }

  const fileName = path.basename(filePath);

  const rpgscriptFileNames = getAllRpgscriptFiles(folderPath, fileName);
  for (let i = 0; i < rpgscriptFileNames.length; i++) {
    const localFileName = rpgscriptFileNames[i];
    const fileSrc = fs.readFileSync(localFileName).toString();
    try {
      parser.parse(localFileName, fileSrc);
    } catch (e) {
      diagnostics.push(
        createErrorDiagnostic(
          fileName,
          1,
          'error',
          `Problem encountered when parsing project directory in file ${path.basename(
            localFileName
          )}: ${String(e)}`
        )
      );
      return {
        diagnostics,
        parser,
      };
    }
  }

  try {
    let ind = filePath.lastIndexOf('/');
    if (ind === -1) {
      ind = filePath.lastIndexOf('\\');
    }
    parser.parse(filePath, fileSrc);
  } catch (e) {
    const msg = String(e);
    const regex = /(.*): \{Line (\d+)\}(.+?):\s(.*) CONTENTS/;
    const matches = regex.exec(msg);
    if (matches) {
      diagnostics.push(
        createErrorDiagnostic(
          fileName,
          Number(matches[2]),
          matches[1],
          matches[4]
        )
      );
    } else {
      logger.log('Unknown error thrown from parser: ', String(e));
    }
  }

  checkCallScriptCommands(fileName, parser, diagnostics);

  // logger.log('Linting done!');

  return {
    diagnostics,
    parser,
  };
};
