import { PROP_DEFAULT_STATE } from '../editor/schema.js';
import { Prop } from './scene.js';
import type { Sprite } from './sprite.js';

export type PropClip = { frames: { sprite?: Sprite; durationMs: number }[]; loop: boolean };
export { PROP_DEFAULT_STATE };

export class AnimatedProp extends Prop {
  private elapsed = 0;

  constructor(
    id: string,
    x: number,
    y: number,
    depthOffset: number,
    z: number,
    sprite: Sprite,
    readonly clips: ReadonlyMap<string, PropClip>,
    public state: string,
    instanceName?: string,
    readonly propId?: string,
    foreground = false,
    blockingOffsets: Prop['blockingOffsets'] = [],
    slidable?: Prop['slidable'],
    climbOffsets: Prop['climbOffsets'] = [],
    climbHeight?: number,
    actionScript?: string,
  ) {
    super(id, x, y, depthOffset, z, sprite, foreground, instanceName, blockingOffsets, slidable, climbOffsets, climbHeight, actionScript);
  }

  /** Active clip for the current state (falls back to default, then a static sprite frame). */
  get clip(): PropClip {
    return (
      this.clips.get(this.state) ??
      this.clips.get(PROP_DEFAULT_STATE) ?? {
        frames: [{ sprite: this.sprite, durationMs: 1000 }],
        loop: true,
      }
    );
  }

  hasAnimationState(state: string): boolean {
    return this.clips.has(state);
  }

  setAnimationState(state: string): void {
    this.state = state;
    this.elapsed = 0;
  }

  override update(deltaMs: number): void {
    this.elapsed += deltaMs;
  }

  override clone(): AnimatedProp {
    return new AnimatedProp(
      this.id,
      this.x,
      this.y,
      this.depthOffset,
      this.z,
      this.sprite,
      this.clips,
      this.state,
      this.instanceName,
      this.propId,
      this.foreground,
      this.blockingOffsets,
      this.slidable,
      this.climbOffsets,
      this.climbHeight,
      this.actionScript,
    );
  }

  override getDrawSprite(): Sprite | undefined {
    const clip = this.clip;
    const total = clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
    let elapsed = clip.loop && total > 0 ? this.elapsed % total : this.elapsed;
    let frame = clip.frames.at(-1);
    for (const candidate of clip.frames) {
      frame = candidate;
      if (elapsed < frame.durationMs) break;
      elapsed -= frame.durationMs;
    }
    return frame?.sprite;
  }
}
