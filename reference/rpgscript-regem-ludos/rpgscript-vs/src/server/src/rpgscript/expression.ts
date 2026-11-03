// Keep numeric expression syntax aligned with the game's expression.ts.
const referencePattern = /\{([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\}|\[([A-Za-z_][\w-]*)\]/g;

export function isNumericExpression(source: string): boolean {
  if (!/^(?:[\d.({[]|[+-]\s*[\d.({[])/.test(source.trim())) return false;
  return /[+\-*/%()]/.test(source.replace(referencePattern, '0')) && !Number.isFinite(Number(source));
}

export function validateNumericExpression(source: string): void {
  const substituted = source.replace(referencePattern, '0');
  const operators = substituted.replace(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g, '0');
  if (!/^[0\s+\-*/%().]+$/.test(operators) || /\/[/*]|\*\//.test(operators))
    throw new Error(`Invalid numeric expression: ${source}`);
  try {
    new Function(`"use strict"; return (${substituted});`);
  } catch {
    throw new Error(`Invalid numeric expression: ${source}`);
  }
}
