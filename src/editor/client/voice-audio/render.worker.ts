import { renderVoicePcm, type VoiceRenderRequest } from './render.js';

// This module is a dedicated worker entry. The editor tsconfig supplies DOM
// globals; type only the worker-side message channel we use here.
const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<VoiceRenderRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
worker.onmessage = ({ data }) => {
  try {
    const result = renderVoicePcm(data);
    const transfer = [result.rendered];
    if (result.original && result.original !== result.rendered) transfer.push(result.original);
    worker.postMessage(result, transfer);
  } catch (error) {
    worker.postMessage({
      error: error instanceof Error ? error.message : 'Could not render take.',
    });
  }
};
