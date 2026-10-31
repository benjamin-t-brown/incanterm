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
