(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  const wrap = $('#canvas-wrap');
  const palette = [
    ['BLACK', '#171b1b'], ['RED', '#ad4144'], ['GREEN', '#568b62'], ['YELLOW', '#b6a25d'],
    ['BLUE', '#527eab'], ['MAGENTA', '#9b6298'], ['CYAN', '#579b9c'], ['WHITE', '#c7d2c9'],
    ['BRIGHT BLACK', '#657773'], ['BRIGHT RED', '#e67973'], ['BRIGHT GREEN', '#8bcd90'], ['BRIGHT YELLOW', '#efcf80'],
    ['BRIGHT BLUE', '#86b3e1'], ['BRIGHT MAGENTA', '#dba0d1'], ['BRIGHT CYAN', '#91d9d5'], ['BRIGHT WHITE', '#f5f4de']
  ];
  const glyphs = ['█', '▓', '▒', '░', '■', '▪', '●', '○', '╔', '╗', '╚', '╝', '═', '║', '╠', '╣', '┌', '┐', '└', '┘', '─', '│', '┼', '╬', '╱', '╲', '╳', '•', '→', '←', '↑', '↓'];
  const zoomSteps = [.35, .5, .75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
  const lastFileKey = 'ed-ascii-last-file';
  const unitW = 16, unitH = 22;
  const blank = () => ({ ch: ' ', fg: 7, bg: 0 });
  const createDoc = (width, height) => ({ format: 'ed-ascii', version: 1, width, height, cells: Array.from({ length: width * height }, blank) });

  let doc = createDoc(120, 40);
  let name = null, savedState = JSON.stringify(doc);
  let tool = 'brush', brushSize = 1, char = '█', fg = 15, bg = 0, colorTarget = 'fg';
  let stamp = null, clipboard = null, selection = null, pasteMode = false;
  let zoom = 1, ox = 30, oy = 30, viewW = 0, viewH = 0;
  let hover = null, gesture = null, spaceHeld = false, keyMode = false, altDown = false, altUsed = false;
  let undoStack = [], redoStack = [], framePending = false, statusTimer, autoFit = true;

  function cell(x, y) { return doc.cells[y * doc.width + x]; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < doc.width && y < doc.height; }
  function cloneCells() { return doc.cells.map(c => ({ ...c })); }
  function snapshot() { return { width: doc.width, height: doc.height, cells: cloneCells() }; }
  function announce(text) {
    $('#status').textContent = text.toUpperCase();
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { $('#status').textContent = keyMode ? 'PRESS KEY TO PAINT · SHIFT FOR SYMBOL · ESC TO CANCEL' : 'READY TO DRAW'; }, 3500);
  }
  function showSaveToast(message, error = false) {
    const toast = document.createElement('div');
    toast.className = `save-toast${error ? ' error' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = error ? '!' : '✓';
    const label = document.createElement('span');
    label.className = 'toast-message';
    label.textContent = message;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close-toast';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    const timeout = setTimeout(() => toast.remove(), 4000);
    close.addEventListener('click', () => { clearTimeout(timeout); toast.remove(); });
    toast.append(icon, label, close);
    const stack = $('#toast-stack');
    stack.append(toast);
    while (stack.children.length > 5) stack.firstElementChild.remove();
  }
  function setKeyMode(active) {
    if (keyMode === active) return;
    keyMode = active;
    $('#key-mode-hint').hidden = !active;
    clearTimeout(statusTimer);
    $('#status').textContent = active ? 'PRESS KEY TO PAINT · SHIFT FOR SYMBOL · ESC TO CANCEL' : 'READY TO DRAW';
  }
  function updateTitle() {
    $('#document-title').firstChild.textContent = (name || 'UNTITLED').toUpperCase() + '.ART ';
    $('#document-title').classList.toggle('dirty', JSON.stringify(doc) !== savedState);
    $('#dimensions').textContent = `${doc.width} × ${doc.height} CELLS`;
  }
  function refreshControls() {
    document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
    $('#tool-status').textContent = `${tool.toUpperCase()} / ${stamp && ['brush', 'fg-brush', 'bg-brush'].includes(tool) ? `${stamp.width} × ${stamp.height} STAMP` : `${brushSize} × ${brushSize}`}`;
    $('#brush-size').value = brushSize;
    $('#brush-number').value = brushSize;
    $('#brush-size-label').textContent = `${brushSize} × ${brushSize}`;
    document.querySelectorAll('[data-size]').forEach(button => button.classList.toggle('active', Number(button.dataset.size) === brushSize));
    $('#character').value = char;
    $('#glyph-preview').textContent = char;
    $('#glyph-preview').style.color = palette[fg][1];
    $('#glyph-preview').style.backgroundColor = palette[bg][1];
    $('#fg-chip').style.backgroundColor = palette[fg][1];
    $('#bg-chip').style.backgroundColor = palette[bg][1];
    $('#fg-target').classList.toggle('active', colorTarget === 'fg');
    $('#bg-target').classList.toggle('active', colorTarget === 'bg');
    document.querySelectorAll('#palette button').forEach(button => button.classList.toggle('selected', Number(button.dataset.color) === (colorTarget === 'fg' ? fg : bg)));
    document.querySelectorAll('#glyph-list button').forEach(button => button.classList.toggle('active', button.dataset.glyph === char && !stamp));
    $('#reset-stamp').hidden = !stamp;
    $('#zoom-label').textContent = `${Math.round(zoom * 100)}%`;
    updateTitle();
    redraw();
  }
  function redraw() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => { framePending = false; draw(); });
  }
  function box(rect, color, dash = []) {
    const x = ox + rect.x * unitW * zoom, y = oy + rect.y * unitH * zoom;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.strokeRect(Math.round(x) + .5, Math.round(y) + .5,
      Math.round(rect.width * unitW * zoom), Math.round(rect.height * unitH * zoom));
    ctx.restore();
  }
  function bounds(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 };
  }
  function brushRect(point) {
    if (stamp && ['brush', 'fg-brush', 'bg-brush'].includes(tool)) return { x: point.x, y: point.y, width: stamp.width, height: stamp.height };
    return { x: point.x - Math.floor((brushSize - 1) / 2), y: point.y - Math.floor((brushSize - 1) / 2), width: brushSize, height: brushSize };
  }
  function draw() {
    if (!viewW || !viewH) return;
    ctx.clearRect(0, 0, viewW, viewH);
    ctx.fillStyle = getComputedStyle(wrap).backgroundColor;
    ctx.fillRect(0, 0, viewW, viewH);
    const cw = unitW * zoom, ch = unitH * zoom;
    const x0 = Math.max(0, Math.floor(-ox / cw)), y0 = Math.max(0, Math.floor(-oy / ch));
    const x1 = Math.min(doc.width, Math.ceil((viewW - ox) / cw)), y1 = Math.min(doc.height, Math.ceil((viewH - oy) / ch));
    ctx.fillStyle = palette[0][1];
    ctx.fillRect(ox, oy, doc.width * cw, doc.height * ch);
    ctx.font = `${Math.max(6, Math.round(16 * zoom))}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = cell(x, y), px = ox + x * cw, py = oy + y * ch;
        if (c.bg !== 0) { ctx.fillStyle = palette[c.bg][1]; ctx.fillRect(px, py, cw + .3, ch + .3); }
        if (c.ch !== ' ') { ctx.fillStyle = palette[c.fg][1]; ctx.fillText(c.ch, px + cw / 2, py + ch / 2 + zoom * .7); }
      }
    }
    if (zoom >= .5) {
      ctx.beginPath();
      ctx.strokeStyle = document.body.classList.contains('light') ? '#8ba89b55' : '#add1c32b';
      ctx.lineWidth = 1;
      for (let x = x0; x <= x1; x++) { const px = Math.round(ox + x * cw) + .5; ctx.moveTo(px, Math.max(oy, 0)); ctx.lineTo(px, Math.min(oy + doc.height * ch, viewH)); }
      for (let y = y0; y <= y1; y++) { const py = Math.round(oy + y * ch) + .5; ctx.moveTo(Math.max(ox, 0), py); ctx.lineTo(Math.min(ox + doc.width * cw, viewW), py); }
      ctx.stroke();
    }
    ctx.strokeStyle = '#add1c3';
    ctx.lineWidth = 2;
    ctx.strokeRect(Math.round(ox) - 1, Math.round(oy) - 1, doc.width * cw + 2, doc.height * ch + 2);
    if (selection) box(selection, '#f2df9e', [6, 4]);
    if (gesture?.kind === 'select' || gesture?.kind === 'pick') box(bounds(gesture.start, gesture.end), '#ffffff', [5, 3]);
    if (hover && inside(hover.x, hover.y)) {
      const rect = pasteMode && clipboard ? { x: hover.x, y: hover.y, width: clipboard.width, height: clipboard.height } :
        ['brush', 'fg-brush', 'bg-brush', 'erase', 'fg-erase', 'bg-erase', 'fg', 'bg'].includes(tool) ? brushRect(hover) : { ...hover, width: 1, height: 1 };
      box(rect, pasteMode ? '#f2df9e' : '#ffffff');
    }
  }
  function resize() {
    const rect = wrap.getBoundingClientRect();
    viewW = rect.width; viewH = rect.height;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewW * ratio);
    canvas.height = Math.round(viewH * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (autoFit) fit(); else redraw();
  }
  function fit() {
    if (!viewW || !viewH) return;
    autoFit = true;
    zoom = Math.max(.35, Math.min(4, (viewW - 64) / (doc.width * unitW), (viewH - 64) / (doc.height * unitH)));
    ox = Math.round((viewW - doc.width * unitW * zoom) / 2);
    oy = Math.round((viewH - doc.height * unitH * zoom) / 2);
    refreshControls();
  }
  function setZoom(value, anchorX = viewW / 2, anchorY = viewH / 2) {
    autoFit = false;
    value = Math.max(.35, Math.min(4, value));
    ox = anchorX - (anchorX - ox) * value / zoom;
    oy = anchorY - (anchorY - oy) * value / zoom;
    zoom = value;
    refreshControls();
  }
  function stepZoom(direction, x, y) {
    const index = direction > 0 ? zoomSteps.findIndex(step => step > zoom + .001) : zoomSteps.findLastIndex(step => step < zoom - .001);
    if (index !== -1) setZoom(zoomSteps[index], x, y);
  }
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left, sy = event.clientY - rect.top;
    return { sx, sy, x: Math.floor((sx - ox) / (unitW * zoom)), y: Math.floor((sy - oy) / (unitH * zoom)) };
  }
  function remember(before) {
    if (!before || (before.width === doc.width && before.height === doc.height &&
      before.cells.every((c, i) => c.ch === doc.cells[i].ch && c.fg === doc.cells[i].fg && c.bg === doc.cells[i].bg))) return;
    undoStack.push(before);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateTitle();
    redraw();
  }
  function undo() {
    if (!undoStack.length) return announce('Nothing to undo');
    redoStack.push(snapshot());
    restore(undoStack.pop()); announce('Undone');
  }
  function redo() {
    if (!redoStack.length) return announce('Nothing to redo');
    undoStack.push(snapshot());
    restore(redoStack.pop()); announce('Redone');
  }
  function restore(previous) {
    const resized = previous.width !== doc.width || previous.height !== doc.height;
    doc.width = previous.width; doc.height = previous.height; doc.cells = previous.cells;
    if (resized) { selection = null; fit(); }
    updateTitle(); redraw();
  }
  function setCell(x, y, value) {
    if (inside(x, y)) doc.cells[y * doc.width + x] = { ...value };
  }
  function brushValue(source, target) {
    if (tool === 'fg-brush') return { ...target, ch: source.ch, fg: source.fg };
    if (tool === 'bg-brush' || tool === 'bg') return { ...target, bg: source.bg };
    if (tool === 'fg') return { ...target, fg: source.fg };
    if (tool === 'fg-erase') return { ...target, ch: ' ', fg: 7 };
    if (tool === 'bg-erase') return { ...target, bg: 0 };
    return source;
  }
  function applyBrush(p) {
    if (stamp && ['brush', 'fg-brush', 'bg-brush'].includes(tool)) {
      for (let y = 0; y < stamp.height; y++) for (let x = 0; x < stamp.width; x++) {
        if (!inside(p.x + x, p.y + y)) continue;
        setCell(p.x + x, p.y + y, brushValue(stamp.cells[y * stamp.width + x], cell(p.x + x, p.y + y)));
      }
    } else {
      const rect = brushRect(p);
      const value = tool === 'erase' ? blank() : { ch: char, fg, bg };
      for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (!inside(x, y)) continue;
        setCell(x, y, brushValue(value, cell(x, y)));
      }
    }
    redraw();
  }
  function flood(p) {
    const original = { ...cell(p.x, p.y) }, replacement = { ch: char, fg, bg };
    if (tool === 'fg-fill' ? original.fg === fg : tool === 'bg-fill' ? original.bg === bg :
      original.ch === char && original.fg === fg && original.bg === bg) return;
    const before = snapshot(), visited = new Uint8Array(doc.cells.length), stack = [p.y * doc.width + p.x];
    while (stack.length) {
      const i = stack.pop();
      if (visited[i]) continue;
      visited[i] = 1;
      const c = doc.cells[i];
      const matches = tool === 'fg-fill' ? c.fg === original.fg : tool === 'bg-fill' ? c.bg === original.bg :
        c.ch === original.ch && c.fg === original.fg && c.bg === original.bg;
      if (!matches) continue;
      doc.cells[i] = tool === 'fg-fill' ? { ...c, fg } : tool === 'bg-fill' ? { ...c, bg } : { ...replacement };
      const x = i % doc.width, y = Math.floor(i / doc.width);
      if (x > 0) stack.push(i - 1);
      if (x < doc.width - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - doc.width);
      if (y < doc.height - 1) stack.push(i + doc.width);
    }
    remember(before);
    announce('Area filled');
  }
  function capture(rect) {
    const cells = [];
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) cells.push({ ...cell(x, y) });
    return { width: rect.width, height: rect.height, cells };
  }
  function copy() {
    if (!selection) return announce('Select an area first');
    clipboard = capture(selection);
    announce(`Copied ${selection.width} × ${selection.height} cells`);
  }
  function paste() {
    if (!clipboard) return announce('Nothing to paste');
    pasteMode = true;
    tool = 'brush';
    refreshControls();
    announce('Click canvas to place paste · Esc to cancel');
  }
  function clearSelection() {
    if (!selection) return;
    const before = snapshot();
    for (let y = selection.y; y < selection.y + selection.height; y++) for (let x = selection.x; x < selection.x + selection.width; x++) setCell(x, y, blank());
    remember(before);
    announce('Selection cleared');
  }
  function setTool(value) {
    setKeyMode(false);
    tool = value; pasteMode = false;
    if (tool === 'fg' || tool.startsWith('fg-')) colorTarget = 'fg';
    if (tool === 'bg' || tool.startsWith('bg-')) colorTarget = 'bg';
    refreshControls(); announce(`${tool} tool selected`);
  }
  function setColorTarget(value) {
    colorTarget = value;
    if (tool === 'fg' || tool === 'bg') tool = value;
    if (tool === 'fg-brush' || tool === 'bg-brush') tool = `${value}-brush`;
    if (tool === 'fg-fill' || tool === 'bg-fill') tool = `${value}-fill`;
    if (tool === 'fg-erase' || tool === 'bg-erase') tool = `${value}-erase`;
    refreshControls();
  }
  function useChar(value) {
    const next = [...value][0] || ' ';
    if (/[\x00-\x1f\x7f-\x9f]/u.test(next)) return refreshControls();
    char = next;
    stamp = null;
    refreshControls();
  }
  function setSize(value) {
    brushSize = Math.min(64, Math.max(1, Number(value) || 1));
    stamp = null;
    refreshControls();
  }
  function shortcutChar(event) {
    const code = event.code, shifted = event.shiftKey;
    if (/^Key[A-Z]$/.test(code)) return shifted ? code.slice(3) : code.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(code)) {
      const digit = Number(code.slice(5));
      return shifted ? ')!@#$%^&*('[digit] : String(digit);
    }
    const punctuation = {
      Backquote: ['`', '~'], Minus: ['-', '_'], Equal: ['=', '+'],
      BracketLeft: ['[', '{'], BracketRight: [']', '}'], Backslash: ['\\', '|'],
      Semicolon: [';', ':'], Quote: ["'", '"'], Comma: [',', '<'],
      Period: ['.', '>'], Slash: ['/', '?'], Space: [' ', ' ']
    };
    if (punctuation[code]) return punctuation[code][Number(shifted)];
    if (/^Numpad[0-9]$/.test(code)) return code.slice(6);
    return [...event.key].length === 1 && !/[\x00-\x1f\x7f-\x9f]/u.test(event.key) ? event.key : null;
  }
  function finishGesture() {
    if (!gesture) return;
    if (gesture.kind === 'paint') remember(gesture.before);
    if (gesture.kind === 'select') { selection = bounds(gesture.start, gesture.end); announce(`Selected ${selection.width} × ${selection.height} cells`); }
    if (gesture.kind === 'pick') {
      const rect = bounds(gesture.start, gesture.end);
      const picked = cell(gesture.start.x, gesture.start.y);
      char = picked.ch; fg = picked.fg; bg = picked.bg;
      stamp = rect.width === 1 && rect.height === 1 ? null : capture(rect);
      brushSize = 1;
      tool = 'brush'; pasteMode = false;
      announce(stamp ? `Stamp selected · ${rect.width} × ${rect.height}` : 'Tile picked');
    }
    gesture = null;
    wrap.classList.remove('panning');
    refreshControls();
  }

  canvas.addEventListener('contextmenu', event => event.preventDefault());
  canvas.addEventListener('pointerdown', event => {
    if (![0, 1, 2].includes(event.button)) return;
    setKeyMode(false);
    canvas.focus({ preventScroll: true });
    const p = point(event);
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 1 || (event.button === 0 && spaceHeld)) {
      autoFit = false;
      gesture = { kind: 'pan', sx: p.sx, sy: p.sy, ox, oy };
      wrap.classList.add('panning');
    } else if (event.button === 2) {
      if (inside(p.x, p.y)) gesture = { kind: 'pick', start: p, end: p };
    } else if (inside(p.x, p.y)) {
      if (pasteMode && clipboard) {
        const before = snapshot();
        for (let y = 0; y < clipboard.height; y++) for (let x = 0; x < clipboard.width; x++) setCell(p.x + x, p.y + y, clipboard.cells[y * clipboard.width + x]);
        remember(before); pasteMode = false; announce('Pasted');
      } else if (tool === 'fill' || tool === 'fg-fill' || tool === 'bg-fill') flood(p);
      else if (tool === 'select') { selection = null; gesture = { kind: 'select', start: p, end: p }; }
      else { gesture = { kind: 'paint', before: snapshot(), last: p }; applyBrush(p); }
    }
    hover = p;
    redraw();
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    const p = point(event);
    hover = p;
    $('#cursor-status').textContent = inside(p.x, p.y) ? `X: ${String(p.x + 1).padStart(2, '0')}   Y: ${String(p.y + 1).padStart(2, '0')}` : 'X: --   Y: --';
    if (gesture?.kind === 'pan') { ox = gesture.ox + p.sx - gesture.sx; oy = gesture.oy + p.sy - gesture.sy; }
    if (gesture?.kind === 'select' || gesture?.kind === 'pick') gesture.end = { x: Math.max(0, Math.min(doc.width - 1, p.x)), y: Math.max(0, Math.min(doc.height - 1, p.y)) };
    if (gesture?.kind === 'paint' && inside(p.x, p.y)) {
      let x = gesture.last.x, y = gesture.last.y;
      const dx = Math.abs(p.x - x), dy = Math.abs(p.y - y);
      const sx = x < p.x ? 1 : -1, sy = y < p.y ? 1 : -1;
      let error = dx - dy;
      while (x !== p.x || y !== p.y) {
        const twice = 2 * error;
        if (twice > -dy) { error -= dy; x += sx; }
        if (twice < dx) { error += dx; y += sy; }
        applyBrush({ x, y });
      }
      gesture.last = p;
    }
    redraw();
  });
  canvas.addEventListener('pointerup', finishGesture);
  canvas.addEventListener('pointercancel', finishGesture);
  canvas.addEventListener('pointerleave', () => { if (!gesture) { hover = null; $('#cursor-status').textContent = 'X: --   Y: --'; redraw(); } });
  canvas.addEventListener('wheel', event => { event.preventDefault(); const p = point(event); stepZoom(event.deltaY < 0 ? 1 : -1, p.sx, p.sy); }, { passive: false });

  async function request(url, options) {
    const response = await fetch(url, options);
    let value;
    try { value = await response.json(); } catch { throw new Error('Server did not respond. Is it running?'); }
    if (!response.ok) throw Object.assign(new Error(value.error || 'Request failed.'), { status: response.status });
    return value;
  }
  async function files() {
    try {
      const { files } = await request('/api/files');
      const list = $('#file-list');
      list.replaceChildren();
      if (!files.length) { list.innerHTML = '<div class="empty-files">NO SAVED FILES YET</div>'; return; }
      for (const file of files) {
        const row = document.createElement('div'); row.className = 'file-item';
        row.classList.toggle('current', file === name);
        const open = document.createElement('button'); open.textContent = `▤  ${file}.json`; open.title = `Open ${file}`;
        open.addEventListener('click', () => openFile(file));
        const remove = document.createElement('button'); remove.className = 'remove-file'; remove.textContent = '×'; remove.title = `Delete ${file}`;
        remove.addEventListener('click', () => deleteFile(file));
        row.append(open, remove); list.append(row);
      }
    } catch (error) { announce(error.message); }
  }
  function okayToReplace() { return JSON.stringify(doc) === savedState || confirm('Discard unsaved changes?'); }
  function loadDocument(data, file) {
    doc = data; name = file; savedState = JSON.stringify(doc);
    if (file) localStorage.setItem(lastFileKey, file);
    else localStorage.removeItem(lastFileKey);
    undoStack = []; redoStack = []; selection = null; stamp = null; pasteMode = false;
    fit(); refreshControls(); files();
  }
  async function reopenLastFile() {
    const file = localStorage.getItem(lastFileKey);
    if (!file) return;
    try {
      const data = await request(`/api/files/${encodeURIComponent(file)}`);
      // Do not replace a document the user opened or edited while this request was in flight.
      if (localStorage.getItem(lastFileKey) !== file || name || $('#size-dialog').open || $('#file-dialog').open || JSON.stringify(doc) !== savedState) return;
      loadDocument(data, file);
      announce(`Reopened ${file}.json`);
    } catch (error) {
      if (localStorage.getItem(lastFileKey) !== file) return;
      if (error.status === 404) localStorage.removeItem(lastFileKey);
      announce(`Could not reopen ${file}.json: ${error.message}`);
    }
  }
  async function openFile(file) {
    if (!okayToReplace()) return;
    try {
      loadDocument(await request(`/api/files/${encodeURIComponent(file)}`), file);
      $('#file-dialog').close();
      announce(`Opened ${file}`);
    }
    catch (error) { announce(error.message); }
  }
  async function save(as = false) {
    let target = name;
    if (!target || as) {
      const suggestion = target || 'untitled';
      const entered = prompt('Save file as (without .json):', suggestion);
      if (entered === null) return;
      target = entered.trim().replace(/\.json$/i, '');
      if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,63}$/.test(target) || target.endsWith('.')) return announce('Invalid file name');
    }
    try {
      await request(`/api/files/${encodeURIComponent(target)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
      name = target; savedState = JSON.stringify(doc); localStorage.setItem(lastFileKey, target);
      updateTitle(); files(); announce(`Saved ${target}.json`);
      showSaveToast(`Saved ${target}.json`);
    } catch (error) { announce(error.message); showSaveToast(`Save failed: ${error.message}`, true); }
  }
  async function deleteFile(file) {
    if (!confirm(`Delete ${file}.json from this server? This cannot be undone.`)) return;
    try {
      await request(`/api/files/${encodeURIComponent(file)}`, { method: 'DELETE' });
      if (localStorage.getItem(lastFileKey) === file) localStorage.removeItem(lastFileKey);
      if (name === file) { name = null; savedState = ''; updateTitle(); }
      files(); announce(`Deleted ${file}.json`);
    } catch (error) { announce(error.message); }
  }
  let sizeMode = 'resize';
  function openSizeDialog(mode) {
    if (mode === 'new' && !okayToReplace()) return;
    setKeyMode(false);
    sizeMode = mode;
    $('#size-dialog-title').textContent = mode === 'new' ? '▦   NEW DOCUMENT' : '▦   RESIZE CANVAS';
    $('#size-description').textContent = mode === 'new'
      ? 'Choose the dimensions for a blank canvas.'
      : 'Existing cells stay at the top-left. Shrinking clips cells outside the new canvas. You can undo a resize.';
    $('#apply-size').textContent = mode === 'new' ? 'CREATE DOCUMENT' : 'RESIZE CANVAS';
    $('#canvas-width').value = mode === 'new' ? 120 : doc.width;
    $('#canvas-height').value = mode === 'new' ? 40 : doc.height;
    if (!$('#size-dialog').open) $('#size-dialog').showModal();
    $('#canvas-width').focus();
    $('#canvas-width').select();
  }
  function newDocument() { openSizeDialog('new'); }
  function resizeCanvas(width, height) {
    if (width === doc.width && height === doc.height) return announce('Canvas size unchanged');
    const before = snapshot(), resized = createDoc(width, height);
    for (let y = 0; y < Math.min(doc.height, height); y++) {
      for (let x = 0; x < Math.min(doc.width, width); x++) {
        resized.cells[y * width + x] = { ...cell(x, y) };
      }
    }
    doc = resized;
    selection = null; pasteMode = false;
    fit(); remember(before);
    announce(`Canvas resized to ${width} × ${height}`);
  }
  function exportANSI() {
    let output = '', previousFg = -1, previousBg = -1;
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        const c = cell(x, y), codes = [];
        if (c.fg !== previousFg) codes.push(c.fg < 8 ? 30 + c.fg : 90 + c.fg - 8);
        if (c.bg !== previousBg) codes.push(c.bg < 8 ? 40 + c.bg : 100 + c.bg - 8);
        if (codes.length) output += `\x1b[${codes.join(';')}m`;
        output += c.ch;
        previousFg = c.fg; previousBg = c.bg;
      }
      output += '\x1b[0m\r\n'; previousFg = previousBg = -1;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([output], { type: 'text/plain;charset=utf-8' }));
    link.download = `${name || 'untitled'}.ans`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    announce('ANSI file exported');
  }
  const actions = {
    new: newDocument, save: () => save(), 'save-as': () => save(true), export: exportANSI,
    resize: () => openSizeDialog('resize'),
    browse: () => { files(); if (!$('#file-dialog').open) $('#file-dialog').showModal(); },
    undo, redo, copy, paste, clear: clearSelection,
    'zoom-in': () => stepZoom(1), 'zoom-out': () => stepZoom(-1), fit
  };
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    button.closest('details')?.removeAttribute('open'); actions[button.dataset.action]();
  }));
  document.querySelectorAll('.menu').forEach(menu => menu.addEventListener('toggle', () => {
    if (menu.open) document.querySelectorAll('.menu').forEach(other => { if (other !== menu) other.open = false; });
  }));
  document.addEventListener('pointerdown', event => {
    setKeyMode(false);
    if (!event.target.closest('.menu')) document.querySelectorAll('.menu').forEach(menu => menu.open = false);
  });
  document.querySelectorAll('[data-tool]').forEach(button => button.addEventListener('click', () => setTool(button.dataset.tool)));
  document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => setSize(button.dataset.size)));
  $('#brush-size').addEventListener('input', event => setSize(event.target.value));
  $('#brush-number').addEventListener('change', event => setSize(event.target.value));
  $('#character').addEventListener('focus', event => event.target.select());
  $('#character').addEventListener('input', event => useChar(event.target.value));
  $('#reset-stamp').addEventListener('click', () => { stamp = null; refreshControls(); });
  for (const glyph of glyphs) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = glyph;
    button.dataset.glyph = glyph; button.title = `Use ${glyph}`;
    button.addEventListener('click', () => useChar(glyph)); $('#glyph-list').append(button);
  }
  palette.forEach(([label, color], index) => {
    const button = document.createElement('button'); button.type = 'button'; button.style.backgroundColor = color;
    button.title = label; button.setAttribute('aria-label', label); button.dataset.color = index;
    button.addEventListener('click', () => { if (colorTarget === 'fg') fg = index; else bg = index; refreshControls(); });
    $('#palette').append(button);
  });
  $('#fg-target').addEventListener('click', () => setColorTarget('fg'));
  $('#bg-target').addEventListener('click', () => setColorTarget('bg'));
  $('#swap-colors').addEventListener('click', () => { [fg, bg] = [bg, fg]; refreshControls(); });
  $('#refresh-files').addEventListener('click', files);
  $('#close-files').addEventListener('click', () => $('#file-dialog').close());
  $('#close-size').addEventListener('click', () => $('#size-dialog').close());
  $('#cancel-size').addEventListener('click', () => $('#size-dialog').close());
  $('#size-form').addEventListener('submit', event => {
    event.preventDefault();
    const width = Number($('#canvas-width').value), height = Number($('#canvas-height').value);
    if (!Number.isInteger(width) || width < 1 || width > 256 || !Number.isInteger(height) || height < 1 || height > 128) {
      announce('Invalid dimensions · max 256 × 128'); return;
    }
    $('#size-dialog').close();
    if (sizeMode === 'new') {
      loadDocument(createDoc(width, height), null);
      if ($('#file-dialog').open) $('#file-dialog').close();
      announce(`New ${width} × ${height} canvas`);
    } else resizeCanvas(width, height);
  });
  $('#zoom-in').addEventListener('click', actions['zoom-in']);
  $('#zoom-out').addEventListener('click', actions['zoom-out']);
  $('#fit').addEventListener('click', fit);
  $('#theme-toggle').addEventListener('click', () => {
    document.body.classList.toggle('light');
    const light = document.body.classList.contains('light');
    $('#theme-toggle').textContent = light ? '◐ DARK MODE' : '☼ LIGHT MODE';
    localStorage.setItem('ed-ascii-theme', light ? 'light' : 'dark'); redraw();
  });
  if (localStorage.getItem('ed-ascii-theme') === 'light') { document.body.classList.add('light'); $('#theme-toggle').textContent = '◐ DARK MODE'; }
  document.addEventListener('keydown', event => {
    const key = event.key.toLowerCase(), ctrl = event.ctrlKey || event.metaKey;
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    const controlShortcut = ctrl && !event.altKey && ['s', 'z', 'y', 'n', 'o', 'c', 'v', 'b', 'f', 'e'].includes(key);
    if (event.key === 'Alt') {
      if (!altDown) { altDown = true; altUsed = ctrl; }
      event.preventDefault();
      return;
    }
    if (altDown) altUsed = true;
    const modal = $('#size-dialog').open ? $('#size-dialog') : $('#file-dialog').open ? $('#file-dialog') : null;
    if (modal) {
      if (event.key === 'Escape') { event.preventDefault(); modal.close(); return; }
      if (controlShortcut && !(typing && (key === 'c' || key === 'v'))) {
        event.preventDefault();
        if (modal.id === 'file-dialog' && key === 's') save();
        if (modal.id === 'file-dialog' && key === 'n') newDocument();
      }
      return;
    }
    if (keyMode && event.key === 'Escape') {
      event.preventDefault(); setKeyMode(false); return;
    }
    if (keyMode && !ctrl && !event.altKey && !event.isComposing) {
      const selected = shortcutChar(event);
      if (selected !== null) {
        event.preventDefault();
        if (typing) document.activeElement.blur();
        setKeyMode(false);
        tool = 'brush'; pasteMode = false;
        useChar(selected);
        announce(`Drawing character: ${selected === ' ' ? 'space' : selected}`);
      }
      return;
    }
    if (keyMode && ctrl) setKeyMode(false);
    if (key === ' ' && !typing && !event.altKey && !ctrl) { spaceHeld = true; event.preventDefault(); }
    if (controlShortcut) {
      if (typing && (key === 'c' || key === 'v')) return;
      event.preventDefault();
      if (key === 's') save();
      if (key === 'z') event.shiftKey ? redo() : undo();
      if (key === 'y') redo();
      if (key === 'n') newDocument();
      if (key === 'o') actions.browse();
      if (key === 'c') copy();
      if (key === 'v') paste();
      if (key === 'b' || key === 'f' || key === 'e') {
        if (typing) document.activeElement.blur();
        setTool(`${event.shiftKey ? 'bg' : 'fg'}-${{ b: 'brush', f: 'fill', e: 'erase' }[key]}`);
      }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); pasteMode = false; selection = null; gesture = null; redraw(); announce('Cancelled'); return; }
    if (typing || ctrl || event.altKey) return;
    if (key === 'b' || key === 'e' || key === 's' || key === 'f') { setTool({ b: 'brush', e: 'erase', s: 'select', f: 'fill' }[key]); event.preventDefault(); }
    if (key === '[' || key === ']') { setTool(key === '[' ? 'fg' : 'bg'); event.preventDefault(); }
    if (event.key === 'Delete' || event.key === 'Backspace') { clearSelection(); event.preventDefault(); }
    if (key === '+' || key === '=') { stepZoom(1); event.preventDefault(); }
    if (key === '-') { stepZoom(-1); event.preventDefault(); }
  });
  document.addEventListener('keyup', event => {
    if (event.key === ' ' && spaceHeld) { event.preventDefault(); spaceHeld = false; }
    if (event.key === 'Alt') {
      event.preventDefault();
      if (altDown && !altUsed && !$('#file-dialog').open && !$('#size-dialog').open) setKeyMode(!keyMode);
      altDown = false; altUsed = false;
    }
  });
  window.addEventListener('blur', () => { spaceHeld = false; altDown = false; altUsed = false; setKeyMode(false); });
  window.addEventListener('beforeunload', event => { if (JSON.stringify(doc) !== savedState) { event.preventDefault(); event.returnValue = ''; } });
  new ResizeObserver(resize).observe(wrap);
  refreshControls();
  files();
  reopenLastFile();
  requestAnimationFrame(resize);
})();
