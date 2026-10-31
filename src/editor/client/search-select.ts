let nextListId = 0;

export function createSearchSelect(options: {
  value: string;
  choices: readonly string[];
  placeholder?: string;
  ariaLabel?: string;
  onInput: (value: string) => void;
  onCommit?: (value: string) => void;
}): HTMLElement {
  const container = document.createElement('span');
  container.className = 'search-select';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = options.value;
  input.placeholder = options.placeholder ?? 'Search or enter a value…';
  if (options.ariaLabel) input.setAttribute('aria-label', options.ariaLabel);
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div');
  list.className = 'search-select-list';
  list.id = `search-select-${++nextListId}`;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.setAttribute('aria-controls', list.id);
  const choices = [...new Set(options.choices)];
  let active = -1;

  function close(): void {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function highlight(index: number): void {
    active = index;
    for (const [at, row] of [...list.children].entries()) {
      row.classList.toggle('active', at === active);
      row.setAttribute('aria-selected', String(at === active));
    }
    if (active < 0) input.removeAttribute('aria-activedescendant');
    else {
      const row = list.children[active] as HTMLElement;
      input.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  function commit(): void {
    input.value = input.value.trim();
    options.onCommit?.(input.value);
  }

  function choose(value: string): void {
    input.value = value;
    options.onInput(value);
    commit();
    input.focus();
    close();
  }

  function showMatches(): void {
    const query = input.value.trim().toLowerCase();
    list.replaceChildren();
    active = -1;
    for (const value of choices.filter((choice) => choice.toLowerCase().includes(query))) {
      const row = document.createElement('div');
      row.id = `${list.id}-option-${list.childElementCount}`;
      row.className = 'search-select-option';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      row.textContent = value;
      row.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        choose(value);
      });
      list.append(row);
    }
    list.hidden = !list.childElementCount;
    input.setAttribute('aria-expanded', String(!list.hidden));
    input.removeAttribute('aria-activedescendant');
  }

  input.addEventListener('focus', showMatches);
  input.addEventListener('input', () => {
    options.onInput(input.value);
    showMatches();
  });
  input.addEventListener('keydown', (event) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && list.hidden) showMatches();
    if (!list.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const last = list.childElementCount - 1;
      highlight(event.key === 'ArrowDown' ? Math.min(last, active + 1) : Math.max(0, active - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!list.hidden && active >= 0) choose(list.children[active].textContent ?? '');
      else {
        commit();
        close();
      }
    } else if (event.key === 'Escape' && !list.hidden) {
      event.preventDefault();
      close();
    }
  });
  input.addEventListener('blur', () => {
    commit();
    close();
  });
  container.append(input, list);
  return container;
}
