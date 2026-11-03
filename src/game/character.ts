import type { CharacterDirection } from '../editor/schema.js';
import type { CellBuffer } from './cell-buffer.js';
import { Prop, type Scene } from './scene.js';
import { findPath, type Point } from './character-movement.js';
import type { Sprite } from './sprite.js';

export type CharacterClip = { frames: { sprite?: Sprite; durationMs: number }[]; loop: boolean };
export type CharacterActivity = Readonly<{
  state: string;
  facing: CharacterDirection;
  speed: number;
  elapsed: number;
  visualKey: string;
  walkElapsed: number;
  destination?: Point;
}>;

export class Character extends Prop {
  handleStep?: (character: Character) => void;
  private elapsed = 0;
  private visualKey = '';
  private walkPath: Point[] = [];
  private walkElapsed = 0;
  private busy = false;
  private conversationBusy = false;
  readonly bottomOffset: number;

  constructor(
    id: string,
    x: number,
    y: number,
    z: number,
    sprite: Sprite,
    readonly characterId: string,
    readonly instanceName: string | undefined,
    public state: string,
    public facing: CharacterDirection,
    public speed = 150,
    readonly clips: ReadonlyMap<string, CharacterClip> = new Map(),
    readonly talkScript?: string,
    readonly scriptName?: string,
  ) {
    super(id, x, y, 0, z, sprite);
    this.bottomOffset = sprite.height - 1 - sprite.originY;
  }

  get bottomY(): number {
    return this.y + this.bottomOffset;
  }

  walkTo(scene: Scene, target: Point): void {
    const elapsed = this.walkPath.length ? this.walkElapsed : 0;
    this.stopWalking();
    this.walkElapsed = elapsed;
    this.walkPath = findPath(scene, this, target);
    if (this.walkPath.length) this.state = 'walk';
  }

  stopWalking(): void {
    if (this.walkPath.length) this.state = 'idle';
    this.walkPath = [];
    this.walkElapsed = 0;
  }

  isWalking(): boolean {
    return this.walkPath.length > 0;
  }

  isBusy(): boolean {
    return this.busy || this.conversationBusy;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
  }

  setConversationBusy(busy: boolean): void {
    this.conversationBusy = busy;
  }

  hasAnimationState(state: string): boolean {
    return state === 'idle' || state === 'walk' || state === 'talking'
      ? this.clips.has(`${state}-${this.facing}`)
      : this.clips.has(state);
  }

  setAnimationState(state: string): void {
    this.stopWalking();
    this.state = state;
    this.elapsed = 0;
    this.animate(0);
  }

  getActivity(): CharacterActivity {
    const destination = this.walkPath.at(-1);
    return {
      state: this.state,
      facing: this.facing,
      speed: this.speed,
      elapsed: this.elapsed,
      visualKey: this.visualKey,
      walkElapsed: this.walkElapsed,
      ...(destination ? { destination: { ...destination } } : {}),
    };
  }

  restoreActivity(activity: CharacterActivity, scene: Scene): void {
    this.walkPath = activity.destination ? findPath(scene, this, activity.destination) : [];
    this.walkElapsed = this.walkPath.length ? activity.walkElapsed : 0;
    this.state = activity.destination && !this.walkPath.length ? 'idle' : activity.state;
    this.facing = activity.facing;
    this.speed = activity.speed;
    this.elapsed = activity.elapsed;
    this.visualKey = activity.visualKey;
  }

  override update(deltaMs: number, scene: Scene): void {
    const speed = Number.isFinite(this.speed) && this.speed > 0 ? this.speed : 150;
    if (this.walkPath.length) this.walkElapsed += deltaMs;
    while (this.walkPath.length && this.walkElapsed >= speed / 2) {
      const target = this.walkPath[this.walkPath.length - 1];
      // Recheck occupancy before each step, including diagonal corners.
      this.walkPath = findPath(scene, this, target);
      const next = this.walkPath[0];
      if (next) {
        const dx = next.x - this.x,
          dy = next.y - this.bottomY;
        const stepDuration = dy === 0 ? speed / 2 : speed;
        if (this.walkElapsed < stepDuration) break;
        this.walkPath.shift();
        this.facing = dx ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        this.x = next.x;
        this.y = next.y - this.bottomOffset;
        this.walkElapsed -= stepDuration;
        this.handleStep?.(this);
      }
      if (!this.walkPath.length) this.state = 'idle';
    }
    if (!this.walkPath.length) this.walkElapsed = 0;
    this.animate(deltaMs);
  }

  clone(): Character {
    const character = new Character(
      this.id,
      this.x,
      this.y,
      this.z,
      this.sprite,
      this.characterId,
      this.instanceName,
      this.state,
      this.facing,
      this.speed,
      this.clips,
      this.talkScript,
      this.scriptName,
    );
    character.setBusy(this.busy);
    return character;
  }

  animate(deltaMs: number): void {
    const key = this.state === 'idle' || this.state === 'walk' || this.state === 'talking'
      ? `${this.state}-${this.facing}` : this.state;
    if (key !== this.visualKey) {
      this.visualKey = key;
      this.elapsed = 0;
    } else this.elapsed += deltaMs;
  }

  override draw(buffer: CellBuffer, originX: number, originY: number): void {
    const clip = this.clips.get(this.state === 'idle' || this.state === 'walk' || this.state === 'talking'
      ? `${this.state}-${this.facing}` : this.state);
    if (!clip) {
      super.draw(buffer, originX, originY);
      return;
    }
    const total = clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
    let elapsed = clip.loop && total > 0 ? this.elapsed % total : this.elapsed;
    let frame = clip.frames[clip.frames.length - 1];
    for (const candidate of clip.frames) {
      frame = candidate;
      if (elapsed < frame.durationMs) break;
      elapsed -= frame.durationMs;
    }
    frame?.sprite?.draw(buffer, originX + this.x, originY + this.y);
  }
}
