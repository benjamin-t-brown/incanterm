const originalConsole = console;
export let logger: {
  log: (...args: any[]) => void;
  error: (...args: any[]) => void;
} = {} as any;

export const enableConsole = () => {
  logger = {
    log: (...args: any) => {
      originalConsole.log('[RPGSCRIPT]', ...args);
    },
    error: (...args: any) => {
      originalConsole.error('[RPGSCRIPT]', ...args);
    },
  };
};

export const disableConsole = () => {
  logger = {
    log: () => {},
    error: () => {},
  };
};
