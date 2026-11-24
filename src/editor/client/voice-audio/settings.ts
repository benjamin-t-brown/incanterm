export const voiceSampleRate = 48_000;
export const maxVoiceTakeSeconds = 180;
// Allow for recorder packet boundaries and stop-event latency after a 5 s capture.
export const maxRoomToneSeconds = 6;
export const voiceCleanupStrengthDb = 6;
export const voiceCleanupAlgorithmVersion = 'spectral-light-v1';

export function getVoiceCleanupSettings(profileId: string) {
  return {
    profileId,
    strengthDb: voiceCleanupStrengthDb,
    algorithmVersion: voiceCleanupAlgorithmVersion,
  };
}
