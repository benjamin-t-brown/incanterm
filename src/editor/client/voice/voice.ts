import { confirmModal } from '../modal.js';
import { createPageShell, setDirtyGuard } from '../shell.js';
import { VoiceRecorder, type MicReport } from './recorder.js';
import { maxVoiceTakeSeconds } from '../voice-audio/index.js';
import {
  getQueue,
  stateLabels,
  type QueueFilter,
  type StudioCatalog,
  type StudioLine,
  type StudioTake,
  type VoiceEdits,
} from './queues.js';
import {
  getStudioCatalog,
  getTakeAudioUrl,
  saveRecording,
  startRoomTone,
  updateFavorite,
  saveTakeEdits,
  publishTake,
  getTakeComparison,
  startTake,
} from './studio-api.js';

function createOption(value: string, label: string): HTMLOptionElement {
  return new Option(label, value);
}

function getMicDescription({ label, settings }: MicReport): string {
  const reported = Object.entries(settings)
    .filter(([name]) =>
      [
        'sampleRate',
        'channelCount',
        'autoGainControl',
        'noiseSuppression',
        'echoCancellation',
      ].includes(name),
    )
    .map(([name, value]) => `${name}: ${value}`);
  return `${label || 'Microphone'}${reported.length ? ` · ${reported.join(' · ')}` : ''}`;
}

type PendingRecording = {
  kind: 'take' | 'tone';
  blob: Blob;
  id: string;
  report: MicReport;
  partial: boolean;
};

export function mountVoiceStudio(root: HTMLElement): () => void {
  root.innerHTML = createPageShell(
    'Voice Studio',
    `
    <h1 class="page-title">Voice Studio</h1>
    <p class="page-copy">Record dialogue requested in saved scripts. Every retake keeps the original.</p>
    <p id="voice-coverage"></p>
    <div class="toolbar-row"><label>Queue <select id="voice-filter" class="text-select"></select></label>
      <button id="voice-refresh" type="button">Refresh scripts</button></div>
    <p id="voice-status" class="voice-notice" role="status" aria-live="polite"></p>
    <p id="voice-drafts" class="page-copy" hidden></p>
    <div id="voice-retry-row" hidden><p id="voice-recovery" class="page-copy"></p><div class="toolbar-row">
      <button id="voice-retry" type="button">Retry upload</button>
      <button id="voice-cancel-upload" type="button" hidden>Cancel upload</button>
      <button id="voice-local" type="button">Listen to unsaved recording</button>
      <button id="voice-download" type="button">Save to file</button>
      <button id="voice-discard" type="button">Discard unsaved recording</button>
    </div></div>
    <div id="voice-issues" class="voice-notice"></div>
    <div class="voice-layout"><section class="zone"><h2>LINE QUEUE</h2><div id="voice-queue" class="voice-queue"></div></section>
    <div id="voice-detail" hidden><section class="zone"><h2 id="voice-state"></h2>
      <p id="voice-location" class="page-copy"></p>
      <div id="voice-context" class="page-copy"></div>
      <strong id="voice-speaker"></strong><p id="voice-text" class="voice-dialogue"></p>
      <div id="voice-comparison" hidden><strong>Recorded wording</strong><p id="voice-before" class="voice-dialogue"></p></div>
      <div class="toolbar-row"><button id="voice-record" type="button">Record</button>
        <button id="voice-stop" type="button">Stop</button>
        <button id="voice-cancel-mic" type="button" hidden>Cancel microphone request</button>
        <button id="voice-next" type="button">Next</button></div>
    </section>
    <section class="zone"><h2>MICROPHONE</h2>
      <div class="toolbar-row"><button id="voice-tone" type="button">Capture 4 seconds of room tone</button></div>
      <p id="voice-profile" class="page-copy"></p><p id="voice-mic" class="page-copy"></p>
    </section>
    <section class="zone"><h2>TAKE HISTORY</h2><p id="voice-empty" class="page-copy">No takes yet.</p>
      <div id="voice-review" hidden><div class="toolbar-row"><label>Take <select id="voice-takes" class="text-select"></select></label></div>
        <div class="toolbar-row"><button id="voice-listen" type="button">Listen to original</button>
          <button id="voice-favorite" type="button">Favorite</button></div>
        <details><summary>Optional audio cleanup</summary>
          <p class="page-copy">Compare Light cleanup against the original at matched speech levels. Listen for clipped word endings. Record a pickup for noises that overlap speech.</p>
          <div class="toolbar-row"><label>Room tone <select id="voice-cleanup" class="text-select"></select></label>
            <label>Gain (dB) <input id="voice-gain" class="text-input" type="number" value="0" step="0.5" min="-24" max="24"></label></div>
          <div class="toolbar-row"><button id="voice-ab-original" type="button">Preview original</button>
            <button id="voice-ab-cleaned" type="button">Preview edited</button>
            <button id="voice-save-edits" type="button">Save settings</button>
            <button id="voice-revert-edits" type="button">Discard draft settings</button></div>
        </details>
        <div class="toolbar-row"><button id="voice-publish" type="button">Approve &amp; publish</button></div>
      </div></section></div></div>
    <audio id="voice-player" controls hidden aria-label="Take playback"></audio>`,
  );

  function getControl<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = root.querySelector<T>(`#voice-${id}`);
    if (!element) throw new Error(`Missing voice control: ${id}`);
    return element;
  }
  const filter = getControl<HTMLSelectElement>('filter');
  const takeSelect = getControl<HTMLSelectElement>('takes');
  const cleanup = getControl<HTMLSelectElement>('cleanup');
  const gain = getControl<HTMLInputElement>('gain');
  const player = getControl<HTMLAudioElement>('player');
  const status = getControl('status');
  filter.add(createOption('requested', 'All requested lines'));
  for (const [key, label] of Object.entries(stateLabels))
    filter.add(createOption(key, key === 'unrequested' ? 'Unrequested with history' : label));

  let catalog: StudioCatalog = { lines: [], errors: [] };
  let line: StudioLine | undefined;
  let take: StudioTake | undefined;
  let busy = false;
  let disposed = false;
  let recorder: VoiceRecorder | undefined;
  let canStop = false;
  let waitingForMic = false;
  let pending: PendingRecording | undefined;
  let upload: AbortController | undefined;
  let publishing = false;
  let objectUrl: string | undefined;
  let profile: { id: string; mic: string } | undefined;
  let sessionId = crypto.randomUUID();
  let edits: VoiceEdits = { profileId: null, gainDb: 0 };
  const drafts = new Map<string, { edits: VoiceEdits; base: VoiceEdits }>();
  let downloadUrl: string | undefined;
  let comparison: { key: string; audio: Awaited<ReturnType<typeof getTakeComparison>> } | undefined;
  const lifetime = new AbortController();

  function stopPlayback(): void {
    player.pause();
    player.removeAttribute('src');
    player.load();
    player.hidden = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  }

  async function playAudio(source: string | Blob): Promise<void> {
    if (disposed) return;
    stopPlayback();
    if (typeof source === 'string') player.src = source;
    else {
      objectUrl = URL.createObjectURL(source);
      player.src = objectUrl;
    }
    player.hidden = false;
    await player.play();
  }
  player.addEventListener('error', () => {
    if (!disposed && player.hasAttribute('src'))
      status.textContent = 'This recording could not be played. Refresh scripts and try again.';
  });

  function getVisibleLines(): StudioLine[] {
    return getQueue(catalog.lines, filter.value as QueueFilter);
  }
  function selectTake(next: StudioTake | undefined): void {
    comparison = undefined;
    take = next;
    edits = take
      ? { ...(drafts.get(take.id)?.edits ?? take.edits) }
      : { profileId: null, gainDb: 0 };
  }
  function renderDraftStatus(): void {
    getControl('drafts').hidden = drafts.size === 0;
    const base = take && drafts.get(take.id)?.base;
    const conflict =
      take &&
      base &&
      (base.gainDb !== take.edits.gainDb || base.profileId !== take.edits.profileId);
    getControl('drafts').textContent =
      `${drafts.size} take${drafts.size === 1 ? ' has' : 's have'} unsaved edit settings in this tab.` +
      (conflict
        ? ' Another reviewer changed the selected take. Discard its draft settings to load the saved values, then reapply your changes.'
        : '');
    getControl('revert-edits').hidden = !take || !drafts.has(take.id);
    getControl('save-edits').textContent =
      take && drafts.has(take.id) ? 'Save draft settings' : 'Save settings';
  }
  function updateDraft(): void {
    if (!take) return;
    if (edits.profileId === take.edits.profileId && edits.gainDb === take.edits.gainDb)
      drafts.delete(take.id);
    else
      drafts.set(take.id, {
        edits: { ...edits },
        base: drafts.get(take.id)?.base ?? { ...take.edits },
      });
    renderDraftStatus();
  }
  function selectLine(next: StudioLine | undefined, takeId?: string): void {
    line = next;
    selectTake(next?.takes.find((t) => t.id === takeId) ?? next?.takes[0]);
  }
  function canRecordLine(): boolean {
    return !!line?.requested && line.state !== 'unavailable' && line.state !== 'archived';
  }
  function setEnabled(id: string, enabled: boolean): void {
    getControl<HTMLButtonElement>(id).disabled = !enabled;
  }
  function render(): void {
    if (disposed) return;
    const queue = getVisibleLines();
    const locked = busy || !!pending;
    filter.disabled = locked;
    setEnabled('refresh', !locked);
    renderDraftStatus();
    getControl('retry-row').hidden = !pending;
    getControl('recovery').textContent = upload
      ? 'Uploading. You can listen, save a local copy, or cancel and retry.'
      : pending?.partial
        ? 'The microphone stopped unexpectedly. Listen to the partial recording, then choose whether to keep it.'
        : 'The original is still in this tab. Retry the upload or save the audio to a file.';
    getControl('retry').textContent = pending?.partial ? 'Save partial recording' : 'Retry upload';
    for (const id of ['retry', 'discard']) setEnabled(id, !busy);
    getControl('cancel-upload').hidden = !upload;
    getControl('cancel-mic').hidden = !waitingForMic;
    const requested = catalog.lines.filter((entry) => entry.requested);
    getControl('coverage').textContent =
      `${requested.filter((entry) => entry.state === 'approved').length} of ${requested.length} requested lines approved`;
    getControl('issues').textContent = catalog.errors.join('\n');
    const list = getControl('queue');
    list.replaceChildren();
    if (!queue.length) list.textContent = 'No lines in this queue.';
    for (const entry of queue) {
      const row = document.createElement('div');
      row.className = 'toolbar-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${entry.speaker}: ${entry.text} · ${stateLabels[entry.state]}`;
      button.disabled = locked;
      button.setAttribute('aria-current', String(entry === line));
      button.onclick = () => {
        stopPlayback();
        selectLine(entry);
        status.textContent = '';
        render();
      };
      row.append(button);
      list.append(row);
    }
    getControl('detail').hidden = !line;
    if (!line) return;
    getControl('state').textContent = stateLabels[line.state];
    getControl('location').textContent = [line.location, line.id].filter(Boolean).join(' · ');
    getControl('context').replaceChildren(
      ...line.context.map((text) => {
        const p = document.createElement('div');
        p.textContent = text;
        return p;
      }),
    );
    const displayedWording = line.state === 'archived' && take ? take : line;
    getControl('speaker').textContent = displayedWording.speaker;
    getControl('text').textContent = displayedWording.text;
    getControl('comparison').hidden =
      !take || line.state === 'archived' || take.revision === line.revision;
    getControl('before').textContent = take ? `${take.speaker}: ${take.text}` : '';
    getControl('record').textContent = line.takes.length ? 'Retake' : 'Record';
    setEnabled('record', !locked && canRecordLine());
    setEnabled('stop', canStop);
    setEnabled('next', !locked && queue.length > 1);
    setEnabled('tone', !locked && canRecordLine());
    getControl('profile').textContent =
      `${profile ? 'Room tone captured for this session.' : 'No room tone in this session.'} Capture a fresh sample after changing the microphone, gain or room.`;
    getControl('empty').hidden = !!take;
    getControl('review').hidden = !take;
    if (!take) return;
    takeSelect.replaceChildren(
      ...line.takes.map((t) =>
        createOption(
          t.id,
          `${new Date(t.createdAt).toLocaleString()}${t.favorite ? ' ★' : ''}${line?.approval?.takeId === t.id ? ' · Approved' : ''}${drafts.has(t.id) ? ' · Draft settings' : ''}`,
        ),
      ),
    );
    takeSelect.value = take.id;
    takeSelect.disabled = locked;
    getControl('favorite').textContent = take.favorite ? 'Remove favorite' : 'Favorite';
    const toneId = take.roomToneId ?? take.edits.profileId;
    cleanup.replaceChildren(createOption('', 'Off'));
    if (toneId) cleanup.add(createOption(toneId, 'Light · take’s room tone'));
    cleanup.value = edits.profileId ?? '';
    cleanup.disabled = locked || !toneId;
    gain.value = String(edits.gainDb);
    gain.disabled = locked;
    for (const id of [
      'listen',
      'favorite',
      'ab-original',
      'ab-cleaned',
      'save-edits',
      'revert-edits',
    ])
      setEnabled(id, !locked);
    setEnabled('publish', !locked && canRecordLine());
  }

  async function refresh(takeId = take?.id): Promise<void> {
    const update = await getStudioCatalog();
    if (disposed) return;
    const previousId = line?.id;
    catalog = update;
    const queue = getVisibleLines();
    selectLine(queue.find((item) => item.id === previousId) ?? queue[0], takeId);
  }
  async function runAction(action: () => Promise<void>): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    status.textContent = '';
    render();
    try {
      await action();
    } catch (error) {
      if (!disposed)
        status.textContent = `${pending ? 'Recording kept in this tab. Retry upload. ' : ''}${error instanceof Error ? error.message : String(error)}`;
    } finally {
      busy = false;
      if (!disposed) render();
    }
  }
  async function sendPendingRecording(): Promise<void> {
    const item = pending;
    if (!item) return;
    status.textContent = 'Saving original recording…';
    const attempt = new AbortController();
    upload = attempt;
    render();
    try {
      await saveRecording(item.kind, item.id, item.blob, attempt.signal);
    } catch (error) {
      if (!attempt.signal.aborted) throw error;
      if (!disposed)
        status.textContent = 'Upload canceled. The recording is still available in this tab.';
      return;
    } finally {
      upload = undefined;
    }
    if (item.kind === 'tone') profile = { id: item.id, mic: getMicSignature(item.report) };
    clearPendingRecording();
    if (disposed) return;
    status.textContent = item.kind === 'take' ? 'Take saved.' : 'Room tone saved.';
    await refresh(item.kind === 'take' ? item.id : take?.id);
  }
  function getMicSignature(report: MicReport): string {
    const {
      deviceId,
      sampleRate,
      channelCount,
      autoGainControl,
      echoCancellation,
      noiseSuppression,
    } = report.settings;
    return JSON.stringify([
      report.label,
      deviceId,
      sampleRate,
      channelCount,
      autoGainControl,
      echoCancellation,
      noiseSuppression,
    ]);
  }
  async function captureRecording(kind: 'take' | 'tone'): Promise<void> {
    if (!line || pending || !canRecordLine()) return;
    stopPlayback();
    const snapshot = line;
    recorder = new VoiceRecorder();
    waitingForMic = true;
    let report: MicReport | undefined;
    let id: string | undefined;
    status.textContent = 'Waiting for microphone permission…';
    render();
    try {
      const result = await recorder.captureAudio(
        async (mic, signal) => {
          report = mic;
          getControl('mic').textContent = getMicDescription(mic);
          if (profile && profile.mic !== getMicSignature(mic)) {
            profile = undefined;
            sessionId = crypto.randomUUID();
          }
          id =
            kind === 'take'
              ? await startTake(snapshot, profile?.id ?? null, signal)
              : await startRoomTone(sessionId, mic, signal);
        },
        () => {
          waitingForMic = false;
          canStop = kind === 'take';
          status.textContent =
            kind === 'take'
              ? `Recording dialogue. Press Stop to save (${maxVoiceTakeSeconds}-second limit).`
              : 'Recording room tone. Stay quiet for four seconds…';
          render();
        },
        kind === 'tone' ? 4000 : (maxVoiceTakeSeconds - 1) * 1000,
      );
      if (disposed || !report || !id) return;
      pending = { kind, ...result, id, report };
      if (result.partial) {
        status.textContent = 'Recording interrupted; partial audio kept in this tab.';
        return;
      }
    } finally {
      recorder = undefined;
      canStop = false;
      waitingForMic = false;
      render();
    }
    await sendPendingRecording();
  }

  function bindAction(id: string, action: () => Promise<void>): void {
    getControl(id).addEventListener('click', () => void runAction(action));
  }
  bindAction('record', () => captureRecording('take'));
  bindAction('tone', () => captureRecording('tone'));
  getControl('stop').onclick = () => {
    canStop = false;
    recorder?.stopRecording();
    render();
  };
  getControl('cancel-mic').onclick = () => recorder?.cancelRecording();
  bindAction('retry', sendPendingRecording);
  getControl('cancel-upload').onclick = () => upload?.abort();
  getControl('local').onclick = () => {
    const recording = pending;
    if (!recording) return;
    void playAudio(recording.blob).catch((error: unknown) => {
      if (!disposed && pending === recording)
        status.textContent = `Could not play the local recording. ${error instanceof Error ? error.message : String(error)}`;
    });
  };
  function clearPendingRecording(): void {
    pending = undefined;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = undefined;
  }
  getControl('download').onclick = () => {
    if (!pending) return;
    downloadUrl ??= URL.createObjectURL(pending.blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    const extension = pending.blob.type.split(';')[0].split('/')[1] || 'audio';
    link.download = `${pending.kind}-${pending.id}${pending.partial ? '-partial' : ''}.${extension}`;
    link.click();
  };
  bindAction('discard', async () => {
    if (
      pending &&
      (await confirmModal(
        'Discard the unsaved recording from this tab? Save it to a file first if you want a copy.',
        'Discard recording',
        { focusCancel: true },
      ))
    ) {
      stopPlayback();
      clearPendingRecording();
      status.textContent = 'Unsaved recording discarded.';
    }
  });
  bindAction('refresh', () => refresh());
  bindAction('listen', async () => {
    if (take) await playAudio(getTakeAudioUrl(take.id));
  });
  bindAction('favorite', async () => {
    if (!take) return;
    await updateFavorite(take.id, !take.favorite);
    await refresh();
  });
  for (const [id, original] of [
    ['ab-original', true],
    ['ab-cleaned', false],
  ] as const) {
    bindAction(id, async () => {
      if (!take) return;
      status.textContent = 'Preparing comparison…';
      const key = JSON.stringify([take.id, edits.profileId, edits.gainDb]);
      if (comparison?.key !== key) {
        stopPlayback();
        comparison = { key, audio: await getTakeComparison(take.id, edits, lifetime.signal) };
      }
      await playAudio(original ? comparison.audio.original : comparison.audio.cleaned);
      status.textContent = 'Playing preview.';
    });
  }
  bindAction('save-edits', async () => {
    if (!take) return;
    await saveTakeEdits(take.id, edits, drafts.get(take.id)?.base ?? take.edits);
    drafts.delete(take.id);
    await refresh();
    status.textContent = 'Take settings saved.';
  });
  bindAction('publish', async () => {
    if (!take || !line || !canRecordLine()) return;
    publishing = true;
    try {
      const older = take.revision !== line.revision;
      if (
        older &&
        !(await confirmModal(
          `Use the recording “${take.speaker}: ${take.text}” for the current wording “${line.speaker}: ${line.text}”?`,
          'Approve older take',
          { focusCancel: true },
        ))
      )
        return;
      if (disposed) return;
      status.textContent = 'Publishing approved audio…';
      const reviewedTake = take;
      const reviewedLine = line;
      await publishTake(
        line,
        take,
        edits,
        older,
        lifetime.signal,
        drafts.get(take.id)?.base ?? take.edits,
        (approval) => {
          reviewedTake.edits = { ...edits };
          reviewedLine.approval = approval;
          reviewedLine.state = 'approved';
          drafts.delete(reviewedTake.id);
        },
      );
    } finally {
      publishing = false;
    }
    if (disposed) return;
    await refresh();
    status.textContent = 'Approved take published.';
  });
  cleanup.onchange = () => {
    edits.profileId = cleanup.value || null;
    updateDraft();
  };
  gain.oninput = () => {
    edits.gainDb = Math.max(-24, Math.min(24, Number(gain.value) || 0));
    updateDraft();
  };
  gain.onchange = () => {
    gain.value = String(edits.gainDb);
  };
  getControl('revert-edits').onclick = () => {
    if (!take) return;
    drafts.delete(take.id);
    selectTake(take);
    render();
  };
  takeSelect.onchange = () => {
    stopPlayback();
    selectTake(line?.takes.find((item) => item.id === takeSelect.value));
    render();
  };
  filter.onchange = () => {
    stopPlayback();
    selectLine(getVisibleLines()[0]);
    render();
  };
  getControl('next').onclick = () => {
    const queue = getVisibleLines();
    if (!line || !queue.length) return;
    stopPlayback();
    selectLine(queue[(queue.indexOf(line) + 1) % queue.length]);
    render();
  };

  function getLeaveMessage(): string {
    return [
      publishing && 'Leaving now interrupts the pending publish. Check its result when you return.',
      (recorder || pending) && 'This tab has an in-progress or unsaved recording.',
      drafts.size > 0 && 'Unsaved take settings will be discarded.',
    ]
      .filter(Boolean)
      .join(' ');
  }
  setDirtyGuard(async () => {
    const message = getLeaveMessage();
    return (
      !message || confirmModal(`Leave Voice Studio? ${message}`, 'Leave', { focusCancel: true })
    );
  });
  function handleUnload(event: BeforeUnloadEvent): void {
    if (getLeaveMessage()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  window.addEventListener('beforeunload', handleUnload);
  void runAction(() => refresh());
  return () => {
    disposed = true;
    lifetime.abort();
    upload?.abort();
    recorder?.cancelRecording();
    stopPlayback();
    clearPendingRecording();
    window.removeEventListener('beforeunload', handleUnload);
  };
}
