export type ExportOptions = {
  projectPath: string;
  outputPath: string;
  sceneReference?: string;
};

export function parseExportArguments(
  args: readonly string[],
  environment: Record<string, string | undefined> = process.env,
): ExportOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (!['--project', '--out', '--scene'].includes(option))
      throw new Error(`Unknown export option ${option}`);
    if (values.has(option)) throw new Error(`Duplicate export option ${option}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new Error(`Missing value after ${option}`);
    values.set(option, value);
  }
  const projectPath = values.get('--project') ?? environment.INCANTERM_PROJECT;
  const outputPath = values.get('--out');
  if (!projectPath || !outputPath)
    throw new Error(
      'Usage: npm run export-game -- --project <folder> --out <new-directory> [--scene <id-or-label>]',
    );
  return { projectPath, outputPath, sceneReference: values.get('--scene') };
}
