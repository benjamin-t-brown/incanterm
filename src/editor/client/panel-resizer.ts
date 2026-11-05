type PanelResizerOptions = {
  container: HTMLElement;
  panel: HTMLElement;
  handle: HTMLElement;
  storageKey: string;
  defaultWidth: number;
  minWidth?: number;
  /** Width the rest of the layout needs, so the panel cannot squeeze it out. */
  reserve?: number;
  applyWidth?: (width: number) => void;
};

export function createPanelResizer(options: PanelResizerOptions): () => void {
  const { container, panel, handle, storageKey, defaultWidth } = options;
  const minWidth = options.minWidth ?? 160;
  const reserve = options.reserve ?? 330;
  const applyWidth =
    options.applyWidth ??
    ((width: number) => {
      panel.style.width = `${width}px`;
    });
  const clampWidth = (width: number) =>
    Math.max(minWidth, Math.min(width, Math.max(minWidth, container.clientWidth - reserve)));
  const setWidth = (width: number, persist = true) => {
    const next = clampWidth(width);
    applyWidth(next);
    handle.setAttribute('aria-valuenow', String(next));
    if (persist) {
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        /* storage unavailable */
      }
    }
  };
  const getPanelWidth = () => panel.getBoundingClientRect().width;
  handle.setAttribute('aria-valuemin', String(minWidth));
  handle.setAttribute('aria-valuemax', String(clampWidth(Number.MAX_SAFE_INTEGER)));
  let storedWidth = 0;
  try {
    storedWidth = Number(localStorage.getItem(storageKey));
  } catch {
    /* storage unavailable */
  }
  setWidth(Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : defaultWidth, false);
  let drag: { pointerId: number; startX: number; startWidth: number } | null = null;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: getPanelWidth() };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag?.pointerId === event.pointerId)
      setWidth(drag.startWidth + event.clientX - drag.startX, false);
  });
  const endResize = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    drag = null;
    handle.classList.remove('dragging');
    setWidth(getPanelWidth());
  };
  handle.addEventListener('pointerup', endResize);
  handle.addEventListener('pointercancel', endResize);
  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 10;
    setWidth(
      event.key === 'Home'
        ? defaultWidth
        : getPanelWidth() + (event.key === 'ArrowRight' ? step : -step),
    );
  });
  handle.addEventListener('dblclick', () => setWidth(defaultWidth));
  const resizeObserver = new ResizeObserver(() => {
    handle.setAttribute('aria-valuemax', String(clampWidth(Number.MAX_SAFE_INTEGER)));
    setWidth(getPanelWidth(), false);
  });
  resizeObserver.observe(container);
  return () => resizeObserver.disconnect();
}
