import type { StudioApproval } from '../../voice/types.js';

export type VoiceState =
  | 'needs-recording'
  | 'needs-review'
  | 'needs-pickup'
  | 'approved'
  | 'unrequested'
  | 'archived'
  | 'unavailable';

export const stateLabels: Record<VoiceState, string> = {
  'needs-recording': 'Needs recording',
  'needs-review': 'Needs review',
  'needs-pickup': 'Needs pickup',
  approved: 'Approved',
  unrequested: 'No voice requested',
  archived: 'Archived',
  unavailable: 'Unavailable',
};

export type VoiceEdits = { profileId: string | null; gainDb: number };
export type StudioTake = {
  id: string;
  revision: string;
  speaker: string;
  text: string;
  createdAt: string;
  favorite: boolean;
  edits: VoiceEdits;
  roomToneId: string | null;
};
export type StudioLine = {
  id: string;
  state: VoiceState;
  requested: boolean;
  revision: string;
  speaker: string;
  text: string;
  location: string;
  context: string[];
  takes: StudioTake[];
  approval?: StudioApproval;
};
export type StudioCatalog = {
  lines: StudioLine[];
  errors: string[];
};
export type QueueFilter = 'requested' | VoiceState;

export function getQueue(lines: StudioLine[], filter: QueueFilter): StudioLine[] {
  return lines.filter((line) => {
    if (filter === 'unrequested') return line.state === filter && line.takes.length > 0;
    if (filter === 'archived' || filter === 'unavailable') return line.state === filter;
    return line.requested && (filter === 'requested' || line.state === filter);
  });
}
