import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  Hover,
  DefinitionParams,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { logger, enableConsole, disableConsole } from './logger';
import { setConnection, setCurrentParser } from './generics';
import {
  getBaseSettings,
  getDocumentSettings,
  getSettingsForDocument,
  setBaseSetting,
  setCurrentSettings,
} from './settings';
import { lintFile } from './rpgscript/lint';
import * as url from 'url';
import {
  DEFAULT_SCRIPTS_ROOT,
  resolveWorkspacePath,
} from './paths';
import { getCompletionObjects } from './rpgscript/autocomplete';
import { getHoverContents, getStorageAssignmentHover } from './rpgscript/hover';
import { getDefinition } from './rpgscript/definition';

const connection = createConnection(ProposedFeatures.all);
setConnection(connection);

const getWordFromLine = (text: string, position: number) => {
  if (text.length - 1 < position || text[position] == ' ') {
    return null;
  }

  const isWordCharacter = (c: string) => {
    return /[a-zA-z+_-\d:&]/.test(c);
  };

  let start = position;
  let end = position;
  while (isWordCharacter(text[start]) && start > 0) {
    start--;
  }
  while (isWordCharacter(text[end]) && end < text.length) {
    end++;
  }

  return text.slice(start, end).trim();
};

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  setBaseSetting(
    'hasConfigurationCapability',
    !!(capabilities.workspace && !!capabilities.workspace.configuration)
  );
  setBaseSetting(
    'hasWorkspaceFolderCapability',
    !!(capabilities.workspace && !!capabilities.workspace.workspaceFolders)
  );
  setBaseSetting(
    'hasDiagnosticRelatedInformationCapability',
    !!(
      capabilities.textDocument &&
      capabilities.textDocument.publishDiagnostics &&
      capabilities.textDocument.publishDiagnostics.relatedInformation
    )
  );
  setBaseSetting('rootPath', params?.workspaceFolders?.[0]?.uri ?? '');

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
      hoverProvider: true,
      definitionProvider: true,
    },
  };
  if (getBaseSettings().hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
});

connection.onInitialized(() => {
  if (getBaseSettings().hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  if (getBaseSettings().hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders((_event) => {
      connection.console.log('Workspace folder change event received.');
    });
  }
});

connection.onDidChangeConfiguration((change) => {
  if (getBaseSettings().hasConfigurationCapability) {
    // Reset all cached document settings
    getDocumentSettings().clear();
  }

  // Revalidate all open text documents
  documents.all().forEach(validateTextDocument);
});

// Only keep settings for open documents
documents.onDidClose((e) => {
  getDocumentSettings().delete(e.document.uri);
  connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
  documents.all().forEach(validateTextDocument);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(() => {
  documents.all().forEach(validateTextDocument);
});

connection.onDidChangeWatchedFiles((_change) => {
  documents.all().forEach(validateTextDocument);
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(_textDocumentPosition.textDocument.uri);
    const pos = _textDocumentPosition.position;

    if (document) {
      const line = document.getText().split('\n')[pos.line] ?? '';
      const word = getWordFromLine(line, pos.character);

      return getCompletionObjects(word ?? '', line);
    }
    return [];
  }
);

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 'sceneCommand') {
    item.detail = 'scene-command';
  } else if (item.data === 'scriptCall') {
    item.detail = 'script-call';
  }
  return item;
});

connection.onHover((params: TextDocumentPositionParams): Hover | undefined => {
  const text = documents.get(params.textDocument.uri)?.getText() ?? '';
  const line = text.split('\n')[params.position.line] ?? '';
  const word = getWordFromLine(line, params.position.character);

  const doc =
    getStorageAssignmentHover(line, params.position.character) ??
    getHoverContents(word ?? '');

  if (!doc) {
    return;
  }

  return {
    contents: doc,
  };
});

connection.onDefinition((params: DefinitionParams) => {
  const text = documents.get(params.textDocument.uri)?.getText() ?? '';
  const line = text.split('\n')[params.position.line] ?? '';

  const link = getDefinition(line);

  if (!link) {
    return undefined;
  }

  return {
    uri: link.targetUri,
    range: link.targetRange,
  };
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  logger.log('Validate rpgscript document.', textDocument.uri);
  const version = textDocument.version;
  const settings = await getSettingsForDocument(textDocument.uri);
  if (documents.get(textDocument.uri) !== textDocument || textDocument.version !== version) return;
  setCurrentSettings(settings);

  if (settings.debug) {
    enableConsole();
  } else {
    disableConsole();
  }

  const text = textDocument.getText();
  const scriptsRoot = resolveWorkspacePath(
    settings.scriptsRoot ?? DEFAULT_SCRIPTS_ROOT
  );

  const filePath = url.fileURLToPath(textDocument.uri);

  logger.log('Lint file', filePath, scriptsRoot);
  const openFiles = new Map(
    documents.all()
      .filter(document => document.uri.startsWith('file:'))
      .map(document => [url.fileURLToPath(document.uri), document.getText()] as [string, string])
  );
  const { diagnostics, parser } = lintFile(filePath, scriptsRoot, text, openFiles);
  if (!getBaseSettings().hasDiagnosticRelatedInformationCapability) {
    diagnostics.forEach(diagnostic => { delete diagnostic.relatedInformation; });
  }
  setCurrentParser(parser);
  logger.log('send diagnostics', textDocument.uri, diagnostics);

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

enableConsole();
logger.log('Initialize rpgscript server');

documents.listen(connection);
connection.listen();
