import { workspace, ExtensionContext } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import * as path from 'path';
import { enableConsole, disableConsole, logger } from './logger';

let client: LanguageClient;

const startClient = (context: ExtensionContext) => {
  const serverModule = context.asAbsolutePath(
    path.join('src', 'server', 'dist', 'server.js')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'rpgscript' }],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/.clientrc'),
      configurationSection: 'rpgscript',
    },
  };

  logger.log('Creating language server...');

  // Create the language client and start the client.
  client = new LanguageClient(
    'rpgscriptLanguageServer',
    'RPGScript Language Server',
    serverOptions,
    clientOptions
  );

  // Start the client. This will also launch the server
  client.start();
};

export function activate(context: ExtensionContext) {
  const section = workspace.getConfiguration('rpgscript');
  const debugEnabled = section.get<boolean>('debug', false);
  const t = 1;
  if (debugEnabled || t) {
    enableConsole();
  } else {
    disableConsole();
  }
  logger.log('RPGScript Activated.');
  if (debugEnabled) {
    logger.log('Debug mode enabled.');
  }

  logger.log('calling startclient');
  startClient(context);
}

export function deactivate() {
  logger.log('RPGScript Deactivated.');
}
