import { moveOpenTab } from '../tab-order.js';

type TabOrderState = {
  tabs: readonly string[];
  onReorder: (tabs: string[]) => void;
};

type TabDragControls = {
  state: TabOrderState;
  draggedId: string | null;
};

const controlsByHost = new WeakMap<HTMLElement, TabDragControls>();
const boundTabs = new WeakSet<HTMLElement>();
const TAB_DRAG_TYPE = 'application/x-incanterm-tab';

function clearDropTargets(host: HTMLElement): void {
  for (const tab of host.querySelectorAll('.editor-document-tab')) {
    tab.classList.remove('editor-tab-drop-before');
    tab.classList.remove('editor-tab-drop-after');
  }
}

function finishDrag(host: HTMLElement, controls: TabDragControls): void {
  controls.draggedId = null;
  clearDropTargets(host);
  for (const tab of host.querySelectorAll('.editor-document-tab'))
    tab.classList.remove('editor-tab-dragging');
}

function getDropSide(tab: HTMLElement, clientX: number): 'before' | 'after' {
  const bounds = tab.getBoundingClientRect();
  return clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
}

export function renderTabReordering(host: HTMLElement, state: TabOrderState): void {
  let controls = controlsByHost.get(host);
  if (!controls) {
    controls = { state, draggedId: null };
    controlsByHost.set(host, controls);
  } else {
    if (state.tabs[0] && !controls.state.tabs.includes(state.tabs[0])) host.scrollLeft = 0;
    controls.state = state;
  }
  const currentControls = controls;
  for (const tab of host.querySelectorAll<HTMLElement>('.editor-document-tab')) {
    const id = tab.dataset.tabId;
    if (!id || boundTabs.has(tab)) continue;
    boundTabs.add(tab);
    tab.draggable = true;
    tab.title = 'Drag to reorder tab';
    tab.addEventListener('dragstart', (event) => {
      if (!event.dataTransfer || !currentControls.state.tabs.includes(id)) {
        event.preventDefault();
        return;
      }
      currentControls.draggedId = id;
      event.stopPropagation();
      event.dataTransfer.setData(TAB_DRAG_TYPE, id);
      event.dataTransfer.effectAllowed = 'move';
      tab.classList.add('editor-tab-dragging');
    });
    tab.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes(TAB_DRAG_TYPE)) return;
      event.stopPropagation();
      clearDropTargets(host);
      const source = currentControls.draggedId;
      if (!source || source === id || !currentControls.state.tabs.includes(source)) {
        event.dataTransfer.dropEffect = 'none';
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      tab.classList.add(`editor-tab-drop-${getDropSide(tab, event.clientX)}`);
    });
    tab.addEventListener('dragleave', (event) => {
      if (!event.relatedTarget || !tab.contains(event.relatedTarget as Node))
        clearDropTargets(host);
    });
    tab.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.types.includes(TAB_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      const source = event.dataTransfer.getData(TAB_DRAG_TYPE);
      const { tabs, onReorder } = currentControls.state;
      const isLocalDrag = source === currentControls.draggedId;
      finishDrag(host, currentControls);
      if (!isLocalDrag) return;
      const next = moveOpenTab(tabs, source, id, getDropSide(tab, event.clientX));
      if (next.some((value, index) => value !== tabs[index])) onReorder(next);
    });
    tab.addEventListener('dragend', () => finishDrag(host, currentControls));
  }
}
