// Traditional terminal encoding for Ctrl+~.
export const CANCEL_UI_AND_OPEN_LOG_INPUT = '\x1e';
export const TOGGLE_LOG_WINDOW_INPUT = '`';

export function hasCancelUiAndOpenLogInput(data: string): boolean {
  // Terminals commonly encode Ctrl+` as NUL and Ctrl+~ as RS.
  return data.includes(CANCEL_UI_AND_OPEN_LOG_INPUT) || data.includes('\x00');
}
