import {
  isAssetId,
  MAX_FRAME_DURATION_MS,
  MAX_SPRITE_HEIGHT,
  MAX_SPRITE_WIDTH,
  spriteLabelError,
} from '../schema.js';

type SpriteDraft = { label: string; width: number; height: number };
type ModalResult = string | boolean | null | SpriteDraft | number;

type ModalRequest = {
  title: string;
  message: string;
  input: string | null;
  size: { width: number; height: number } | null;
  duration: boolean;
  assetId: boolean;
  readonlyId?: string;
  confirmLabel: string;
  cancelLabel: string | null;
  resolve: (value: ModalResult) => void;
};

let dialog: HTMLDialogElement | null = null;
let titleNode: HTMLElement | null = null;
let messageNode: HTMLElement | null = null;
let field: HTMLElement | null = null;
let idLabel: HTMLElement | null = null;
let readonlyIdField: HTMLElement | null = null;
let readonlyIdInput: HTMLInputElement | null = null;
let sizeRow: HTMLElement | null = null;
let widthInput: HTMLInputElement | null = null;
let heightInput: HTMLInputElement | null = null;
let input: HTMLInputElement | null = null;
let confirmButton: HTMLButtonElement | null = null;
let cancelButton: HTMLButtonElement | null = null;
let active: ModalRequest | null = null;
const queue: ModalRequest[] = [];

export function isModalOpen(): boolean {
  return dialog?.open === true;
}

export function alertModal(message: string): Promise<void> {
  return openModal({
    title: 'NOTICE',
    message,
    input: null,
    size: null,
    duration: false,
    assetId: false,
    confirmLabel: 'OK',
    cancelLabel: null,
  }).then(() => undefined);
}

export function confirmModal(message: string, confirmLabel = 'OK'): Promise<boolean> {
  return openModal({
    title: 'CONFIRM',
    message,
    input: null,
    size: null,
    duration: false,
    assetId: false,
    confirmLabel,
    cancelLabel: 'CANCEL',
  }).then((value) => value === true);
}

export function promptModal(message: string, value = ''): Promise<string | null> {
  return openModal({
    title: 'ENTER',
    message,
    input: value,
    size: null,
    duration: false,
    assetId: false,
    confirmLabel: 'OK',
    cancelLabel: 'CANCEL',
  }).then((result) => (typeof result === 'string' ? result : null));
}

export function askNewSprite(): Promise<SpriteDraft | null> {
  return openModal({
    title: 'NEW SPRITE',
    message: '',
    input: '',
    size: { width: 3, height: 3 },
    duration: false,
    assetId: false,
    confirmLabel: 'OK',
    cancelLabel: 'CANCEL',
  }).then((result) => (result !== null && typeof result === 'object' ? result : null));
}

export function askSaveAs(currentLabel: string): Promise<string | null> {
  return openModal({
    title: 'SAVE AS',
    message: '',
    input: currentLabel,
    size: null,
    duration: false,
    assetId: false,
    confirmLabel: 'SAVE',
    cancelLabel: 'CANCEL',
  }).then((result) => (typeof result === 'string' ? result : null));
}

export function askAssetMeta(kind: 'SPRITESHEET' | 'ANIMATION', label: string, id: string): Promise<string | null> {
  return openModal({
    title: `${kind} META`,
    message: '',
    input: label,
    size: null,
    duration: false,
    assetId: false,
    readonlyId: id,
    confirmLabel: 'APPLY',
    cancelLabel: 'CANCEL',
  }).then((result) => (typeof result === 'string' ? result : null));
}

export function askAnimationSpeed(currentMs: number): Promise<number | null> {
  return askDuration('ANIMATION SPEED', 'Milliseconds between frames', currentMs);
}

export function askFrameDuration(currentMs: number): Promise<number | null> {
  return askDuration('FRAME DURATION', 'Milliseconds for every frame', currentMs);
}

function askDuration(title: string, message: string, currentMs: number): Promise<number | null> {
  return openModal({
    title,
    message,
    input: String(currentMs),
    size: null,
    duration: true,
    assetId: false,
    confirmLabel: 'OK',
    cancelLabel: 'CANCEL',
  }).then((result) => (typeof result === 'number' ? result : null));
}

function openModal(options: Omit<ModalRequest, 'resolve'>): Promise<ModalResult> {
  return new Promise((resolve) => {
    queue.push({ ...options, resolve });
    showNext();
  });
}

function showNext(): void {
  if (active || queue.length === 0) return;
  const request = queue.shift();
  if (!request) return;
  active = request;
  const elements = ensureDialog();
  elements.title.textContent = request.title;
  elements.message.textContent = request.message;
  elements.message.hidden = request.message.length === 0;
  elements.input.setAttribute(
    'aria-label',
    request.duration
      ? 'Milliseconds between frames'
      : request.assetId
        ? 'Sprite id'
        : request.readonlyId
          ? 'Sprite label'
          : request.message || (request.size ? 'Sprite label' : 'Label'),
  );
  elements.readonlyIdField.hidden = request.readonlyId === undefined;
  elements.readonlyIdInput.value = request.readonlyId ?? '';
  if (request.readonlyId) {
    elements.input.setAttribute('aria-label', `${request.title === 'ANIMATION META' ? 'Animation' : 'Spritesheet'} label`);
    elements.readonlyIdInput.setAttribute('aria-label', `${request.title === 'ANIMATION META' ? 'Animation' : 'Spritesheet'} ID`);
  }
  elements.confirmButton.textContent = request.confirmLabel;
  if (request.cancelLabel) {
    elements.cancelButton.hidden = false;
    elements.cancelButton.textContent = request.cancelLabel;
  } else {
    elements.cancelButton.hidden = true;
  }
  if (request.input === null) {
    elements.field.hidden = true;
    elements.input.value = '';
    elements.input.type = 'text';
  } else {
    elements.field.hidden = false;
    elements.input.value = request.input;
    elements.input.type = request.duration ? 'number' : 'text';
    if (request.duration) {
      elements.input.min = '1';
      elements.input.max = String(MAX_FRAME_DURATION_MS);
      elements.input.step = '1';
    } else {
      elements.input.removeAttribute('min');
      elements.input.removeAttribute('max');
      elements.input.removeAttribute('step');
    }
  }
  if (request.size === null) {
    elements.sizeRow.hidden = true;
    elements.idLabel.hidden =
      !request.duration && !request.assetId && request.title !== 'SAVE AS' && !request.readonlyId;
    elements.idLabel.textContent = request.duration ? 'MS' : request.assetId ? 'ID' : 'LABEL';
  } else {
    elements.sizeRow.hidden = false;
    elements.idLabel.hidden = false;
    elements.idLabel.textContent = 'LABEL';
    elements.widthInput.value = String(request.size.width);
    elements.heightInput.value = String(request.size.height);
  }
  elements.dialog.showModal();
  if (request.input === null) elements.confirmButton.focus();
  else {
    elements.input.focus();
    elements.input.select();
  }
}

function finish(value: ModalResult): void {
  const request = active;
  active = null;
  dialog?.close();
  request?.resolve(value);
  showNext();
}

function readSpriteDraft(): SpriteDraft | string {
  const label = (input?.value ?? '').trim();
  const width = Number(widthInput?.value);
  const height = Number(heightInput?.value);
  const labelError = spriteLabelError(label);
  if (labelError) return labelError;
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    width > MAX_SPRITE_WIDTH ||
    !Number.isInteger(height) ||
    height < 1 ||
    height > MAX_SPRITE_HEIGHT
  ) {
    return `Width is 1–${MAX_SPRITE_WIDTH} and height is 1–${MAX_SPRITE_HEIGHT}`;
  }
  return { label, width, height };
}

function ensureDialog(): {
  dialog: HTMLDialogElement;
  title: HTMLElement;
  message: HTMLElement;
  field: HTMLElement;
  idLabel: HTMLElement;
  readonlyIdField: HTMLElement;
  readonlyIdInput: HTMLInputElement;
  sizeRow: HTMLElement;
  widthInput: HTMLInputElement;
  heightInput: HTMLInputElement;
  input: HTMLInputElement;
  confirmButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
} {
  if (
    dialog &&
    titleNode &&
    messageNode &&
    field &&
    idLabel &&
    readonlyIdField &&
    readonlyIdInput &&
    sizeRow &&
    widthInput &&
    heightInput &&
    input &&
    confirmButton &&
    cancelButton
  ) {
    return {
      dialog,
      title: titleNode,
      message: messageNode,
      field,
      idLabel,
      readonlyIdField,
      readonlyIdInput,
      sizeRow,
      widthInput,
      heightInput,
      input,
      confirmButton,
      cancelButton,
    };
  }
  const element = document.createElement('dialog');
  element.id = 'editor-modal';
  element.innerHTML = `<form>
    <div class="dialog-heading"><span id="editor-modal-title">CONFIRM</span></div>
    <p id="editor-modal-message"></p>
    <label id="editor-modal-field"><span id="editor-modal-id-label" hidden>ID</span><input id="editor-modal-input" spellcheck="false" autocomplete="off"></label>
    <label id="editor-modal-readonly-id" hidden>ID<input id="editor-modal-readonly-id-input" type="text" aria-label="Spritesheet ID" readonly></label>
    <div id="editor-modal-size" class="size-fields" hidden>
      <label>WIDTH<input id="editor-modal-width" type="number" min="1" max="256" step="1"></label>
      <span>×</span>
      <label>HEIGHT<input id="editor-modal-height" type="number" min="1" max="128" step="1"></label>
    </div>
    <div class="size-dialog-actions">
      <button id="editor-modal-ok" type="submit">OK</button>
      <button id="editor-modal-cancel" type="button">CANCEL</button>
    </div>
  </form>`;
  element.addEventListener('cancel', (event) => {
    event.preventDefault();
    finish(active?.input === null && active.cancelLabel === null ? true : null);
  });
  const form = element.querySelector('form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!active) return;
    if (active.size) {
      const draft = readSpriteDraft();
      if (typeof draft === 'string') {
        if (messageNode) {
          messageNode.hidden = false;
          messageNode.textContent = draft;
        }
        return;
      }
      finish(draft);
      return;
    }
    if (active.duration) {
      const duration = Number(input?.value);
      if (!Number.isInteger(duration) || duration < 1 || duration > MAX_FRAME_DURATION_MS) {
        if (messageNode) {
          messageNode.hidden = false;
          messageNode.textContent = `Duration is 1–${MAX_FRAME_DURATION_MS} milliseconds`;
        }
        return;
      }
      finish(duration);
      return;
    }
    if (active.assetId) {
      const id = (input?.value ?? '').trim();
      if (!isAssetId(id)) {
        if (messageNode) {
          messageNode.hidden = false;
          messageNode.textContent = 'Use a short lowercase id';
        }
        return;
      }
      finish(id);
      return;
    }
    finish(active.input !== null ? (input?.value ?? '') : true);
  });
  document.querySelector('#editor-modal')?.remove();
  document.body.append(element);
  dialog = element;
  const nextTitle = element.querySelector<HTMLElement>('#editor-modal-title');
  const nextMessage = element.querySelector<HTMLElement>('#editor-modal-message');
  const nextField = element.querySelector<HTMLElement>('#editor-modal-field');
  const nextIdLabel = element.querySelector<HTMLElement>('#editor-modal-id-label');
  const nextReadonlyIdField = element.querySelector<HTMLElement>('#editor-modal-readonly-id');
  const nextReadonlyIdInput = element.querySelector<HTMLInputElement>(
    '#editor-modal-readonly-id-input',
  );
  const nextSize = element.querySelector<HTMLElement>('#editor-modal-size');
  const nextWidth = element.querySelector<HTMLInputElement>('#editor-modal-width');
  const nextHeight = element.querySelector<HTMLInputElement>('#editor-modal-height');
  const nextInput = element.querySelector<HTMLInputElement>('#editor-modal-input');
  const nextConfirm = element.querySelector<HTMLButtonElement>('#editor-modal-ok');
  const nextCancel = element.querySelector<HTMLButtonElement>('#editor-modal-cancel');
  if (
    !nextTitle ||
    !nextMessage ||
    !nextField ||
    !nextIdLabel ||
    !nextReadonlyIdField ||
    !nextReadonlyIdInput ||
    !nextSize ||
    !nextWidth ||
    !nextHeight ||
    !nextInput ||
    !nextConfirm ||
    !nextCancel
  ) {
    throw new Error('Editor modal is missing controls');
  }
  titleNode = nextTitle;
  messageNode = nextMessage;
  field = nextField;
  idLabel = nextIdLabel;
  readonlyIdField = nextReadonlyIdField;
  readonlyIdInput = nextReadonlyIdInput;
  sizeRow = nextSize;
  widthInput = nextWidth;
  heightInput = nextHeight;
  input = nextInput;
  confirmButton = nextConfirm;
  cancelButton = nextCancel;
  nextCancel.addEventListener('click', () => {
    if (!active) return;
    finish(active.input === null && active.cancelLabel === null ? true : null);
  });
  element.addEventListener('keydown', (event) => event.stopPropagation());
  element.addEventListener('keyup', (event) => event.stopPropagation());
  return {
    dialog: element,
    title: nextTitle,
    message: nextMessage,
    field: nextField,
    idLabel: nextIdLabel,
    readonlyIdField: nextReadonlyIdField,
    readonlyIdInput: nextReadonlyIdInput,
    sizeRow: nextSize,
    widthInput: nextWidth,
    heightInput: nextHeight,
    input: nextInput,
    confirmButton: nextConfirm,
    cancelButton: nextCancel,
  };
}
