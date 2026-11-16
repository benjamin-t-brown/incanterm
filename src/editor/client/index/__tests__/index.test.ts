import { afterEach, expect, it, vi, type Mock } from 'vitest';
import { requestJson } from '../../api.js';
import { saveProjectSelection } from '../../project.js';
import { mountIndex } from '../index.js';

vi.mock('../../api.js', () => ({
  requestJson: vi.fn(),
  jsonRequest: (_method: string, body: unknown) => body,
}));
vi.mock('../../project.js', () => ({
  getOpenedProject: () => null,
  saveProjectSelection: vi.fn(),
  clearProjectSelection: vi.fn(),
  importLegacyEditorState: vi.fn(),
}));
vi.mock('../../shell.js', () => ({
  createPageShell: (_title: string, content: string) => content,
  allowLeave: async () => true,
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

type TestElement = {
  tagName: string;
  textContent: string;
  children: TestElement[];
  append: (...children: TestElement[]) => void;
  addEventListener: Mock<(event: string, listener: () => void) => void>;
};

function createElement(tagName: string): TestElement {
  const children: TestElement[] = [];
  return {
    tagName,
    textContent: '',
    children,
    append: function appendChildren(...items: TestElement[]) {
      children.push(...items);
    },
    addEventListener: vi.fn((_event: string, _listener: () => void) => {}),
  };
}

it('renders project names and long paths as separate text blocks and keeps the card clickable', async () => {
  const project = {
    name: 'A very long project name <not markup>',
    root: `C:\\games\\${'a-long-folder-name\\'.repeat(12)}MyGame`,
    manifestPath: 'C:\\games\\MyGame\\incanterm.json',
  };
  vi.mocked(requestJson)
    .mockResolvedValueOnce({ projects: [project] })
    .mockResolvedValueOnce(project);
  vi.stubGlobal('document', { createElement });
  const assign = vi.fn();
  vi.stubGlobal('window', { location: { assign } });
  const list = createElement('div');
  const root = {
    innerHTML: '',
    querySelector: (selector: string) => (selector === '#project-list' ? list : null),
  } as unknown as HTMLElement;

  const cleanup = mountIndex(root);
  await vi.waitFor(() => expect(list.children).toHaveLength(1));
  const button = list.children[0];
  expect(button.tagName).toBe('button');
  expect(button.children.map((child) => [child.tagName, child.textContent])).toEqual([
    ['strong', project.name],
    ['span', project.root],
  ]);
  const [event, click] = button.addEventListener.mock.calls[0];
  expect(event).toBe('click');
  click();
  await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  expect(requestJson).toHaveBeenLastCalledWith('/api/projects/open', {
    path: project.manifestPath,
  });
  expect(saveProjectSelection).toHaveBeenCalledWith(project.manifestPath);
  cleanup();
});
