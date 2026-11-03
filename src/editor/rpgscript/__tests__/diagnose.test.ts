import { describe, expect, it } from 'vitest';
import { diagnoseScript } from '../diagnose.js';

describe('RPGScript diagnose', () => {
  it('reports a parse error, an unknown command, and a missing callScript target', () => {
    const source = [
      '@intro',
      '+wait(',
      '+dance()',
      "+callScript('missing')",
      'Guide: "Hello"',
    ].join('\n');
    expect(diagnoseScript(source, ['intro'])).toEqual([
      { line: 2, severity: 'error', message: 'Invalid command, missing parentheses' },
      { line: 3, severity: 'warning', message: 'No command exists with name "dance"' },
      { line: 4, severity: 'error', message: 'No script exists with name "missing".' },
    ]);
  });

  it('accepts a known command and a script defined in the project', () => {
    const source = ['@intro', "+callScript('other')", '+wait(1)'].join('\n');
    expect(diagnoseScript(source, ['intro', 'other'])).toEqual([]);
  });
});
