type VoiceAudio = {
  play(): Promise<void>;
  pause(): void;
  removeAttribute(name: string): void;
  load(): void;
};

export function getVoiceClipUrl(socketUrl: string, checksum: string): string {
  const url = new URL(`/voice/${checksum}.mp3`, socketUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return url.href;
}

/** Each cue owns its media element, including any pending play promise. */
export class VoicePlayer {
  private active?: VoiceAudio;
  private enabled = true;

  constructor(private readonly createAudio: (url: string) => VoiceAudio) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stop();
  }

  play(url: string): void {
    this.stop();
    if (!this.enabled) return;
    const audio = this.createAudio(url);
    this.active = audio;
    void audio.play().then(() => {
      if (this.active !== audio) audio.pause();
    }).catch(() => {
      // Autoplay restrictions, unsupported formats and missing clips are text-only.
      if (this.active === audio) this.stop();
    });
  }

  stop(): void {
    const audio = this.active;
    if (!audio) return;
    this.active = undefined;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
}
