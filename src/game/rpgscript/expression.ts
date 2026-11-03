const referencePattern = /\{([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\}|\[([A-Za-z_][\w-]*)\]/g;

export class ScriptExpressionError extends Error {}

export function isNumericExpression(source: string): boolean {
  if (!/^(?:[\d.({[]|[+-]\s*[\d.({[])/.test(source.trim())) return false;
  return /[+\-*/%()]/.test(source.replace(referencePattern, '0')) && !Number.isFinite(Number(source));
}

export function validateNumericExpression(source: string): void {
  const substituted = source.replace(referencePattern, '0');
  // Only numeric operands and arithmetic operators reach JavaScript's parser.
  const operators = substituted.replace(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g, '0');
  if (!/^[0\s+\-*/%().]+$/.test(operators) || /\/[/*]|\*\//.test(operators))
    throw new ScriptExpressionError(`Invalid numeric expression: ${source}`);
  try {
    // Compile only: JavaScript validates the syntax without evaluating operands.
    new Function(`"use strict"; return (${substituted});`);
  } catch {
    throw new ScriptExpressionError(`Invalid numeric expression: ${source}`);
  }
}

export function evaluateNumericExpression(
  source: string,
  getReference: (name: string, local: boolean) => unknown,
): number {
  validateNumericExpression(source);
  const resolved = source.replace(referencePattern, (_match, global: string | undefined, local: string | undefined) => {
    const name = local ?? global ?? '';
    const value = getReference(name, local !== undefined);
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new ScriptExpressionError(`Numeric expression ${source}: ${local === undefined ? `{${name}}` : `[${name}]`} must be a finite number, got ${String(value)}`);
    return `(${value})`;
  });
  try {
    // biome-ignore lint/security/noGlobalEval: Only validated arithmetic syntax and finite numeric substitutions reach eval.
    const result: unknown = eval(`(${resolved})`);
    if (typeof result !== 'number' || !Number.isFinite(result))
      throw new Error('result must be a finite number');
    return result;
  } catch (error) {
    throw new ScriptExpressionError(`Numeric expression ${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
