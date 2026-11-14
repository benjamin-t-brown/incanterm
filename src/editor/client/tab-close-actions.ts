type TabCloseState = {
  tabs: readonly string[];
  active: string | null;
  closeTab: (id: string) => Promise<void>;
};

type TabCloseControls = {
  state: TabCloseState;
  busy: boolean;
  left: HTMLButtonElement;
  right: HTMLButtonElement;
};

const controlsByHost = new WeakMap<HTMLElement, TabCloseControls>();

export function getSideTabs(
  tabs: readonly string[],
  active: string | null,
  direction: 'left' | 'right',
): string[] {
  const index = active === null ? -1 : tabs.indexOf(active);
  if (index < 0) return [];
  return direction === 'left' ? tabs.slice(0, index) : tabs.slice(index + 1);
}

function refreshControls(controls: TabCloseControls): void {
  for (const direction of ['left', 'right'] as const) {
    controls[direction].disabled =
      controls.busy || !getSideTabs(controls.state.tabs, controls.state.active, direction).length;
  }
}

async function closeSideTabs(
  controls: TabCloseControls,
  direction: 'left' | 'right',
): Promise<void> {
  if (controls.busy) return;
  const ids = getSideTabs(controls.state.tabs, controls.state.active, direction);
  controls.busy = true;
  refreshControls(controls);
  try {
    for (const id of ids) {
      // Keep using the normal close flow, including dirty-tab confirmation.
      await controls.state.closeTab(id);
      if (controls.state.tabs.includes(id)) break;
    }
  } finally {
    controls.busy = false;
    refreshControls(controls);
  }
}

export function renderTabCloseActions(host: HTMLElement, state: TabCloseState): void {
  let controls = controlsByHost.get(host);
  if (!controls) {
    const strip = document.createElement('div');
    strip.className = `${host.className} editor-tab-strip`;
    host.before(strip);
    strip.append(host);
    const actions = document.createElement('div');
    actions.className = 'editor-tab-close-actions';
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', 'Close neighboring tabs');
    const left = document.createElement('button');
    const right = document.createElement('button');
    controls = { state, busy: false, left, right };
    controlsByHost.set(host, controls);
    for (const direction of ['left', 'right'] as const) {
      const button = controls[direction];
      button.type = 'button';
      button.textContent = direction === 'left' ? '× ←' : '→ ×';
      button.title = `Close tabs to the ${direction} of the selected tab`;
      button.setAttribute('aria-label', button.title);
      const currentControls = controls;
      button.addEventListener('click', () => void closeSideTabs(currentControls, direction));
      actions.append(button);
    }
    strip.append(actions);
  }
  controls.state = state;
  refreshControls(controls);
}
