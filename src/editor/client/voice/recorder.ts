import {
  getVoiceCaptureConstraints,
  getVoiceCaptureSettings,
  getVoiceRecorderOptions,
} from '../voice-audio/capture.js';

export type MicReport = {
  label: string;
  settings: MediaTrackSettings;
};
export type CapturedAudio = { blob: Blob; partial: boolean };

/** A recorder is single-use. Cancelling also releases a stream granted after navigation. */
export class VoiceRecorder {
  private recorder: MediaRecorder | undefined;
  private stream: MediaStream | undefined;
  private readonly cancellation = new AbortController();

  async captureAudio(
    prepare: (report: MicReport, signal: AbortSignal) => Promise<void>,
    onStart: () => void,
    durationMs: number,
  ): Promise<CapturedAudio> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
      throw new Error('Microphone recording requires Chrome or Edge on the local editor.');
    const options = getVoiceRecorderOptions();
    const { signal } = this.cancellation;
    const cancelled = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    // Permission prompts cannot be aborted. Unblock the UI immediately, and
    // release a late permission grant even if another capture has since begun.
    const permission = navigator.mediaDevices
      .getUserMedia(getVoiceCaptureConstraints())
      .then((stream) => {
        if (signal.aborted) {
          for (const track of stream.getTracks()) track.stop();
          throw signal.reason;
        }
        this.stream = stream;
        return stream;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stream = await Promise.race([permission, cancelled]);
      signal.throwIfAborted();
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('The microphone did not provide an audio track.');
      await Promise.race([
        prepare({ label: track.label, settings: getVoiceCaptureSettings(track) }, signal),
        cancelled,
      ]);
      signal.throwIfAborted();
      const recorder = new MediaRecorder(stream, { ...options, audioBitsPerSecond: 96_000 });
      this.recorder = recorder;
      return await Promise.race([
        cancelled,
        new Promise<CapturedAudio>((resolve, reject) => {
          const chunks: Blob[] = [];
          let partial = false;
          track.addEventListener(
            'ended',
            () => {
              partial = true;
            },
            { once: true },
          );
          recorder.ondataavailable = ({ data }) => {
            if (data.size) chunks.push(data);
          };
          // The recorder dispatches final dataavailable and stop *after* error.
          recorder.onerror = () => {
            partial = true;
          };
          recorder.onstop = () => {
            if (!chunks.length) {
              reject(
                new Error(
                  partial
                    ? 'Recording failed with no audio. Check the microphone.'
                    : 'The microphone returned an empty recording.',
                ),
              );
              return;
            }
            resolve({
              blob: new Blob(chunks, { type: recorder.mimeType || options.mimeType }),
              partial,
            });
          };
          recorder.start();
          onStart();
          timer = setTimeout(() => this.stopRecording(), durationMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      this.stopMicrophone();
      this.recorder = undefined;
    }
  }

  stopRecording(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  cancelRecording(): void {
    this.cancellation.abort(new Error('Recording cancelled'));
    this.stopRecording();
    this.stopMicrophone();
  }

  private stopMicrophone(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
  }
}
