import { afterEach, expect, it, vi } from 'vitest';
import { createTestElement, TestElement } from '../../__tests__/dom-fixture.js';
import { requestJson } from '../../api.js';
import { saveDraft } from '../../save.js';
import { mountScripts } from '../scripts.js';

vi.mock('../../api.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api.js')>()),
  requestJson: vi.fn(),
}));
vi.mock('../../save.js', () => ({ saveDraft: vi.fn() }));
vi.mock('../../shell.js', () => ({ createPageShell: () => '', setDirtyGuard: vi.fn() }));

class ScriptSource extends TestElement {
  selectionStart = 0;
  selectionEnd = 0;
  setSelectionRange(start: number, end: number) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

afterEach(() => vi.unstubAllGlobals());

it('visibly disables both actions while saving, then allows opting out on the same ID', async () => {
  const source = new ScriptSource('textarea');
  const list = new TestElement();
  const request = new TestElement('button');
  const optOut = new TestElement('button');
  const elements: Record<string, TestElement> = {
    '#script-list': list, '#script-source': source, '#script-id': new TestElement(),
    '#diagnostics': new TestElement(), '#request-voice': request, '#no-voice': optOut,
    '#generate-voice-ids': new TestElement('button'),
  };
  const root = Object.assign(new TestElement('main'), {
    querySelector: (selector: string) => elements[selector] ?? null,
  });
  vi.stubGlobal('document', { createElement: createTestElement, addEventListener: vi.fn() });
  vi.stubGlobal('window', { clearTimeout, setTimeout, addEventListener: vi.fn() });
  vi.mocked(requestJson).mockImplementation(async <T>(url: string) => {
    if (url === '/api/scripts') return { files: ['test'] } as T;
    if (url === '/api/scripts/test') return { id: 'test', source: '@test\nAda: "Hi"' } as T;
    if (url === '/api/scripts/diagnose') return { diagnostics: [] } as T;
    throw new Error(`Unexpected request ${url}`);
  });
  let finishSave: () => void = () => { throw new Error('Save not started'); };
  const pending = new Promise<void>((resolve) => { finishSave = resolve; });
  vi.mocked(saveDraft).mockImplementation(async (_url, doc) => {
    await pending;
    return doc;
  });

  const unmount = mountScripts(root as unknown as HTMLElement);
  try {
    expect([request.disabled, optOut.disabled]).toEqual([true, true]);
    await vi.waitFor(() => expect(list.children).toHaveLength(1));
    list.children[0].dispatch('click');
    await vi.waitFor(() => expect(request.disabled).toBe(false));
    source.setSelectionRange(6, 6);
    request.dispatch('click');
    expect([request.disabled, optOut.disabled]).toEqual([true, true]);
    const enabled = source.value;
    expect(enabled).toContain('v_');
    finishSave();
    await vi.waitFor(() => expect([request.disabled, optOut.disabled]).toEqual([false, false]));
    optOut.dispatch('click');
    expect(vi.mocked(saveDraft).mock.calls[1].slice(1)).toEqual([
      { id: 'test', source: enabled.replace('// voice ', '// no-voice ') }, { id: 'test', source: enabled },
    ]);
    await vi.waitFor(() => expect(optOut.disabled).toBe(false));
  } finally { unmount(); }
});
