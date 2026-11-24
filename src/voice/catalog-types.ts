import type { VoiceLine } from './contracts.js';

export type VoiceLocation = { file: string; script: string; line: number };
export type VoiceContext = Pick<VoiceLine, 'speaker' | 'text'>;
export type VoiceCatalogLine = VoiceLocation &
  VoiceLine & {
    before: VoiceContext | null;
    after: VoiceContext | null;
  };
export type VoiceCatalog = {
  lines: VoiceCatalogLine[];
  duplicates: { lineId: string; locations: VoiceLocation[] }[];
  /** If nonempty, absence from `lines` cannot prove a line was archived. */
  errors: { file: string; message: string }[];
};
