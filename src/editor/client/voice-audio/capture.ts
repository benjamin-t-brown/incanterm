/** Use the same unprocessed microphone request for room tone and dialogue. */
export function getVoiceCaptureConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      channelCount: { ideal: 1 },
      autoGainControl: false,
      echoCancellation: false,
      noiseSuppression: false,
    },
    video: false,
  };
}

/** Snapshot only reported values: missing settings do not mean "disabled". */
export function getVoiceCaptureSettings(
  track: MediaStreamTrack,
): MediaTrackSettings & Record<string, string | boolean | number> {
  const result: Record<string, string | boolean | number> = {};
  for (const [key, value] of Object.entries(track.getSettings())) {
    if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
      result[key] = value;
  }
  return result;
}

export function getVoiceRecorderOptions(): MediaRecorderOptions {
  if (typeof MediaRecorder === 'undefined') throw new Error('Audio recording is unavailable.');
  for (const mimeType of [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType, audioBitsPerSecond: 96_000 };
  }
  throw new Error('No supported voice recording format is available.');
}
