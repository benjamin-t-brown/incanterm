export function showEditorToast(stack: HTMLElement, message: string, error = false): void {
  const toast = document.createElement('div');
  toast.className = error ? 'save-toast error' : 'save-toast';
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = error ? '!' : '✓';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'toast-message';
  label.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close-toast';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.addEventListener('click', () => toast.remove());
  toast.append(icon, label, close);
  stack.append(toast);
  setTimeout(() => toast.remove(), 4000);
}
