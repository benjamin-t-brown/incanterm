import { createRequire } from 'node:module';

// ssh2 publishes CommonJS only, with no named ESM exports.
const ssh2 = createRequire(import.meta.url)('ssh2') as typeof import('ssh2');

export const Client = ssh2.Client;
export const Server = ssh2.Server;
export const utils = ssh2.utils;
