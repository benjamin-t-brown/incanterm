import { requestJson } from '../api.js';
import { createPageShell } from '../shell.js';

type AudioEntry = { id: string; name: string };

export function mountSoundboard(root: HTMLElement): () => void {
  root.innerHTML = createPageShell(
    'Soundboard',
    `<h1 class="page-title">Soundboard</h1>
    <p class="page-copy">Every sound already in assets/audio. Add or remove files on disk, then refresh.</p>
    <div class="toolbar-row"><button type="button" id="refresh-audio">REFRESH</button></div>
    <div id="sounds" class="sound-list"></div>`,
  );
  const list = root.querySelector<HTMLElement>('#sounds');
  let playing: HTMLAudioElement | null = null;
  async function refresh(): Promise<void> {
    if (!list) return;
    const { files } = await requestJson<{ files: AudioEntry[] }>('/api/audio');
    list.replaceChildren();
    if (files.length === 0) {
      list.innerHTML = '<p class="page-copy">No wav, ogg, or mp3 files yet.</p>';
      return;
    }
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'sound-row';
      const name = document.createElement('span');
      name.textContent = file.name;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'PLAY';
      button.addEventListener('click', () => {
        if (playing) {
          playing.pause();
          playing = null;
        }
        const audio = new Audio(`/api/audio/${encodeURIComponent(file.name)}`);
        playing = audio;
        button.textContent = 'PLAYING';
        void audio.play();
        audio.addEventListener('ended', () => {
          if (playing === audio) button.textContent = 'PLAY';
        });
      });
      row.append(name, button);
      list.append(row);
    }
  }
  root.querySelector('#refresh-audio')?.addEventListener('click', () => void refresh());
  void refresh();
  return () => {
    playing?.pause();
  };
}
