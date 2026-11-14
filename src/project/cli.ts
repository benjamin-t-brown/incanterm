import { loadProject, type LoadedProject } from './project.js';

export type ProjectCliOptions = {
  projectPath?: string;
  assetsRoot?: string;
  sceneId?: string;
  remaining: string[];
};

export function parseProjectArguments(args: readonly string[]): ProjectCliOptions {
  const result: ProjectCliOptions = { remaining: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (['--project', '--assets', '--scene'].includes(argument)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value after ${argument}`);
      if (argument === '--project') result.projectPath = value;
      else if (argument === '--assets') result.assetsRoot = value;
      else result.sceneId = value;
    } else result.remaining.push(argument);
  }
  if (result.projectPath && result.assetsRoot)
    throw new Error('Use --project or --assets, not both');
  return result;
}

export async function loadProjectFromArguments(
  options: ProjectCliOptions,
  environment: Record<string, string | undefined> = process.env,
): Promise<LoadedProject | undefined> {
  if (options.assetsRoot) return undefined;
  const location = options.projectPath ?? environment.INCANTERM_PROJECT;
  return location ? loadProject(location) : undefined;
}
