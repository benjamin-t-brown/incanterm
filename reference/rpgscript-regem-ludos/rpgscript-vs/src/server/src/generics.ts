import { RPGScriptParser } from './rpgscript/rpgscript';

let connection: any = null;
export const setConnection = (v: any) => (connection = v);
export const getConnection = () => connection;

let sceneCommands: string[];
export const setCommands = (v: string[]) => (sceneCommands = v);
export const getCommands = () => sceneCommands;

export interface SceneCommandMetadata {
  name: string;
  lineNum: number;
  args: string[];
}
let sceneCommandMetadata: SceneCommandMetadata[] = [];
export const setCommandsMetadata = (v: SceneCommandMetadata[]) =>
  (sceneCommandMetadata = v);
export const getCommandsMetadata = () => sceneCommandMetadata;

let currentParser: RPGScriptParser = null as any;
export const setCurrentParser = (p: RPGScriptParser) => (currentParser = p);
export const getCurrentParser = () => currentParser;
