type TestListener = (event: {
  target: TestElement;
  key?: string;
  preventDefault: () => void;
}) => void;

export class TestElement {
  children: TestElement[] = [];
  className = '';
  textContent = '';
  title = '';
  value = '';
  disabled = false;
  draggable = false;
  open = false;
  width = 0;
  height = 0;
  type = '';
  hidden = false;
  id = '';
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, TestListener[]>();
  style = { setProperty: function setStyleProperty(_key: string, _value: string) {} };
  classList = {
    toggle: (name: string, force?: boolean) => {
      const classes = new Set(this.className.split(' ').filter(Boolean));
      const enabled = force ?? !classes.has(name);
      if (enabled) classes.add(name);
      else classes.delete(name);
      this.className = [...classes].join(' ');
      return enabled;
    },
    add: (name: string) => {
      this.classList.toggle(name, true);
    },
    remove: (name: string) => {
      this.classList.toggle(name, false);
    },
  };

  constructor(readonly tagName: string = 'div') {}

  append(...children: TestElement[]): void {
    this.children.push(...children);
  }

  replaceChildren(...children: TestElement[]): void {
    this.children = children;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  get childElementCount(): number {
    return this.children.length;
  }

  querySelectorAll(selector: string): TestElement[] {
    return this.children.flatMap((child) => [
      ...(selector.startsWith('.') && child.className.split(' ').includes(selector.slice(1))
        ? [child]
        : []),
      ...child.querySelectorAll(selector),
    ]);
  }

  addEventListener(type: string, listener: TestListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener(type: string, listener: TestListener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((item) => item !== listener),
    );
  }

  dispatch(type: string, key?: string): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ target: this, key, preventDefault: function handlePreventDefault() {} });
  }

  focus(): void {}
  scrollIntoView(): void {}

  showModal(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
    this.dispatch('close');
  }
}

export function createTestElement(tagName: string): TestElement {
  return new TestElement(tagName);
}
