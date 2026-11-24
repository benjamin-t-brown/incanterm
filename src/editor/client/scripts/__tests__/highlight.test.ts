import { expect, it } from 'vitest';
import { renderScriptHighlight } from '../highlight.js';

it('distinguishes dialogue, comments, calls and references while preserving editable text', () => {
  const source = '#timer@tick,250\n\t+?is([ready]):+log({clock})\n  Pilot: "<tag> // &"\n// +ignore()\n';
  const html = renderScriptHighlight(source);
  expect(html).toContain('<span class="rpg-header">#timer@tick</span>');
  expect(html).toContain('<span class="rpg-control">?is</span>');
  expect(html).toContain('<span class="rpg-call">log</span>');
  expect(html).toContain('<span class="rpg-reference">[ready]</span>');
  expect(html).toContain('<span class="rpg-speaker">  Pilot</span>');
  expect(html).toContain('<span class="rpg-string">"&lt;tag&gt; // &amp;"</span>');
  expect(html).toContain('<span class="rpg-comment">// +ignore()</span>');
  expect(html.replace(/<\/?span\b[^>]*>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')).toBe(source);
});
