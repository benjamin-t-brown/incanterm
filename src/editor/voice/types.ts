import type {
  VoiceApproval,
  VoiceEditSettings,
  VoiceTake as RecordedTake,
} from '../../voice/contracts.js';
import type { VoiceCatalog } from '../../voice/catalog-types.js';

export type VoiceTake = RecordedTake & {
  scriptId: string;
  mimeType: string;
  favorite: boolean;
  roomToneId: string | null;
  edits: VoiceEditSettings;
};

export type VoiceRoomTone = {
  id: string;
  sessionId: string;
  settings: Record<string, string | boolean | number>;
  mimeType: string;
  createdAt: string;
};

export type StudioApproval = VoiceApproval & { renderSha256?: string };

export type VoiceHistory = {
  takes: VoiceTake[];
  approvals: StudioApproval[];
  roomTones: VoiceRoomTone[];
};

export type VoiceStudioResponse = VoiceHistory & { catalog: VoiceCatalog };
