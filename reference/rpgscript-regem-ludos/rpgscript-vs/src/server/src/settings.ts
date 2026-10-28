import { getConnection } from './generics';

const baseSettings = {
  hasConfigurationCapability: true,
  hasWorkspaceFolderCapability: true,
  hasDiagnosticRelatedInformationCapability: true,
  rootPath: '',
};

interface RPGScriptSettings {
  scriptsRoot: string;
  sceneCommandsPath: string;
  debug: boolean;
}

const documentSettings: Map<string, Thenable<RPGScriptSettings>> = new Map();

export function setBaseSetting(k: string, b: boolean | string | string[]) {
  baseSettings[k] = b;
}
export function getBaseSettings() {
  return baseSettings;
}

export function getDocumentSettings() {
  return documentSettings;
}

export function getSettingsForDocument(
  resource: string
): Thenable<RPGScriptSettings> {
  if (!baseSettings.hasConfigurationCapability) {
    return Promise.resolve({});
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = getConnection().workspace.getConfiguration({
      scopeUri: resource,
      section: 'rpgscript',
    }) as Thenable<RPGScriptSettings>;
    documentSettings.set(resource, result);
  }

  return result;
}

let currentSettings: RPGScriptSettings = {
  scriptsRoot: '',
  sceneCommandsPath: '',
  debug: false,
};
export function setCurrentSettings(s: RPGScriptSettings) {
  currentSettings = s;
}
export function getCurrentSettings() {
  return currentSettings;
}
