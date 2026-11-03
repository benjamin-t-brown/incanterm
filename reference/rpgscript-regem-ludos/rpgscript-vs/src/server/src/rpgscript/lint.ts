import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { RPGScriptParser } from './rpgscript';
import { getSceneCommands } from './commands';
import { logger } from '../logger';
import { declaredScriptSignatures, duplicateNameDiagnostics } from './duplicates';
import { localScopeDiagnostics } from './local-scope';
import { getOnceIdDiagnostics } from './once-id';

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
  filePath: string,
  source: string,
  scripts: ReadonlyMap<string, readonly string[]>,
  parser: RPGScriptParser,
  diagnostics: Diagnostic[]
) => {
  const lines = source.split(/\r?\n/);
  const callScriptStrings = parser.getCallScriptStrings();
  callScriptStrings.forEach(({ scriptName, lineNum, fileName, argCount }) => {
    const parameters = scripts.get(scriptName);
    if (canonicalPath(fileName) === filePath && (!parameters || parameters.length !== argCount)) {
      const line = lines[lineNum - 1] ?? '';
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        code: parameters ? 'script-argument-count' : 'unknown-script',
        range: {
          start: { line: lineNum - 1, character: line.length - line.trimStart().length },
          end: { line: lineNum - 1, character: line.trimEnd().length },
        },
        message: parameters
          ? `Script ${scriptName} expects ${parameters.length} argument(s), got ${argCount}.`
          : `No script exists with name "${scriptName}".`,
        source: 'RPGScript:' + path.basename(filePath),
      });
    }
  });
};

const canonicalPath = (file: string) => {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const getAllRpgscriptFiles = (scriptsDir: string) => {
  const files = fs.readdirSync(scriptsDir);
  let rpgscriptFileNames: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const nextFileName = path.join(scriptsDir, files[i]);

    const stat = fs.statSync(nextFileName);
    if (stat.isDirectory()) {
      rpgscriptFileNames = rpgscriptFileNames.concat(
        getAllRpgscriptFiles(nextFileName)
      );
    } else if (path.extname(nextFileName) === '.rpgscript') {
      rpgscriptFileNames.push(nextFileName);
    }
  }

  return rpgscriptFileNames.sort();
};

export const lintFile = (
  filePath: string,
  scriptRoot: string,
  fileSrc: string,
  openFiles: ReadonlyMap<string, string> = new Map()
) => {
  const folderPath = canonicalPath(scriptRoot);
  filePath = canonicalPath(filePath);
  const parser = new RPGScriptParser({
    commands: getSceneCommands(),
  });

  // logger.log('Lint: ', filePath, folderPath);

  if (!fs.existsSync(folderPath)) {
    throw new Error('No folder exists with name: ' + folderPath);
  }

  const fileName = path.basename(filePath);
  const sources = new Map<string, string>();
  for (const file of getAllRpgscriptFiles(folderPath)) {
    sources.set(canonicalPath(file), fs.readFileSync(file, 'utf8'));
  }
  for (const [file, source] of openFiles) {
    const normalized = canonicalPath(file);
    const relative = path.relative(folderPath, normalized);
    if (!path.isAbsolute(relative) && relative !== '..' &&
        !relative.startsWith('..' + path.sep) && path.extname(normalized) === '.rpgscript') {
      sources.set(normalized, source);
    }
  }
  sources.set(filePath, fileSrc);
  const diagnostics = [
    ...duplicateNameDiagnostics(filePath, folderPath, sources),
    ...localScopeDiagnostics(filePath, fileSrc),
    ...getOnceIdDiagnostics(filePath, fileSrc),
  ];
  for (const [localFileName, source] of sources) {
    if (localFileName === filePath) continue;
    try {
      parser.parse(localFileName, source);
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

  checkCallScriptCommands(filePath, fileSrc, declaredScriptSignatures(sources), parser, diagnostics);

  // logger.log('Linting done!');

  return {
    diagnostics,
    parser,
  };
};
