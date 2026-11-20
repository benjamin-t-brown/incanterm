// Keep aligned with the standalone language extension's script-signature.ts.
export function parseScriptSignature(header: string): { name: string; parameters: string[] } {
  const match = /^([^\s()]+)(?:\s*\(([^()]*)\))?$/.exec(header.trim());
  if (!match) throw new Error('Invalid script signature');
  const parameters = match[2]?.trim() ? match[2].split(',').map((name) => name.trim()) : [];
  if (parameters.some((name) => !/^[A-Za-z_][\w-]*$/.test(name))) {
    throw new Error('Invalid script parameter name');
  }
  if (new Set(parameters).size !== parameters.length) throw new Error('Duplicate script parameter');
  return { name: match[1], parameters };
}

export function getTriggerScriptPrefix(line: string): string | undefined {
  return /^#[\w-]*@/.exec(line)?.[0];
}

export function parseTriggerScriptHeader(line: string, prefix: string) {
  const type = prefix.slice(1, -1) || 'action';
  if (type !== 'action' && type !== 'step' && type !== 'load' && type !== 'timer') {
    throw new Error(`Unsupported shorthand trigger type "${type}"`);
  }
  // Only split on commas outside the signature's parameter list.
  const [header, ...args] = line.slice(prefix.length).split(/,(?![^()]*\))/);
  const signature = parseScriptSignature(header);
  if (signature.parameters.length > 0) {
    throw new Error('Trigger shorthand scripts cannot have parameters');
  }
  let intervalMs: number | undefined;
  if (type === 'timer') {
    intervalMs = Number(args[0]);
    if (args.length !== 1 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('Timer interval must be a positive number of milliseconds');
    }
  } else if (args.length > 0) {
    throw new Error(`The ${type} trigger shorthand does not take arguments`);
  }
  return { signature, type, intervalMs };
}
