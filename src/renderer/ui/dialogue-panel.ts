import type { PortraitAsset, PortraitFrame } from '../../game/portrait-assets.js';
import { BorderBox } from './border-box.js';
import { UIElement, type DrawContext } from './element.js';
import { ParagraphWrapped } from './paragraph-wrapped.js';

const FG = { r: 205, g: 211, b: 209 };
const BG = { r: 16, g: 20, b: 25 };
const HINT_FG = { r: 128, g: 128, b: 128 };
const SPEAKER_FG = { r: 64, g: 160, b: 255 };
const ACTIVE_BORDER = { r: 255, g: 255, b: 255 };
const INACTIVE_BORDER = { r: 128, g: 128, b: 128 };

class PortraitImage extends UIElement {
  frame: PortraitFrame | undefined;

  protected paint(ctx: DrawContext): void {
    const frame = this.frame;
    if (!frame?.cells) return;
    const left = Math.floor((this.width - frame.width) / 2);
    const top = Math.floor((this.height - frame.height) / 2);
    for (let y = Math.max(0, -top); y < Math.min(frame.height, this.height - top); y++) {
      for (let x = Math.max(0, -left); x < Math.min(frame.width, this.width - left); x++) {
        const px = x + left;
        const py = y + top;
        ctx.set(px, py, frame.cells[y * frame.width + x]);
      }
    }
  }
}

export class DialoguePanel extends BorderBox {
  readonly message: ParagraphWrapped;
  readonly speakerBox: BorderBox;
  readonly rightSpeakerBox: BorderBox;
  readonly advanceHint: ParagraphWrapped;
  readonly portraitBox: BorderBox;
  readonly rightPortraitBox: BorderBox;
  twoSpeakers = false;
  portraitSide: 'left' | 'right' = 'left';
  reservePortraitSpace = false;
  private readonly image: PortraitImage;
  private readonly rightImage: PortraitImage;
  private readonly speakerLabel: ParagraphWrapped;
  private readonly rightSpeakerLabel: ParagraphWrapped;
  private portrait: PortraitAsset | undefined;
  private rightPortrait: PortraitAsset | undefined;

  constructor(id: string, x: number, y: number, width: number, height: number) {
    super(id, x, y, width, height, { border: 'double', fg: FG, bg: BG });
    this.portraitBox = new BorderBox(`${id}-portrait`, 1, 1, 6, Math.max(2, height - 2), {
      border: 'rounded',
      fg: FG,
      bg: BG,
      visible: false,
    });
    this.image = new PortraitImage(`${id}-image`, 0, 0, 4, Math.max(1, height - 4));
    this.portraitBox.addChild(this.image);
    this.rightPortraitBox = new BorderBox(`${id}-right-portrait`, 0, 0, 6, Math.max(2, height - 2), {
      border: 'rounded', fg: FG, bg: BG, visible: false,
    });
    this.rightImage = new PortraitImage(`${id}-right-image`, 0, 0, 4, Math.max(1, height - 4));
    this.rightPortraitBox.addChild(this.rightImage);
    this.speakerBox = new BorderBox(`${id}-speaker`, 1, 0, 4, 3, {
      border: 'double', fg: SPEAKER_FG, bg: BG, visible: false,
    });
    this.speakerLabel = new ParagraphWrapped(`${id}-speaker-label`, 1, 0, 2, '', {
      fg: SPEAKER_FG, bg: BG,
    });
    this.speakerBox.addChild(this.speakerLabel);
    this.rightSpeakerBox = new BorderBox(`${id}-right-speaker`, 0, 0, 4, 3, {
      border: 'double', fg: INACTIVE_BORDER, bg: BG, visible: false,
    });
    this.rightSpeakerLabel = new ParagraphWrapped(`${id}-right-speaker-label`, 1, 0, 2, '', {
      fg: SPEAKER_FG, bg: BG,
    });
    this.rightSpeakerBox.addChild(this.rightSpeakerLabel);
    this.message = new ParagraphWrapped(`${id}-message`, 1, 2, width - 4, '', {
      fg: FG,
      bg: BG,
    });
    this.advanceHint = new ParagraphWrapped(`${id}-advance-hint`, 0, 0, '[Space/Enter]'.length, '[Space/Enter]', {
      fg: HINT_FG,
      bg: BG,
      visible: false,
    });
    this.addChild(this.message);
    this.addChild(this.advanceHint);
    this.resize(width, height);
  }

  setPortrait(asset: PortraitAsset | undefined, frame?: PortraitFrame, side: 'left' | 'right' = 'left'): void {
    this.portrait = asset;
    this.image.frame = frame;
    this.portraitSide = side;
    this.resize(this.width, this.height);
  }

  setSpeaker(actor: string | undefined): void {
    this.twoSpeakers = false;
    this.rightSpeakerBox.visible = false;
    this.rightPortraitBox.visible = false;
    this.speakerBox.fg = ACTIVE_BORDER;
    this.speakerLabel.fg = SPEAKER_FG;
    this.portraitBox.fg = FG;
    this.speakerBox.visible = actor !== undefined;
    this.speakerLabel.text = actor ?? '';
    this.speakerLabel.width = Math.max(1, this.speakerLabel.text.length);
    this.speakerBox.width = Math.max(4, this.speakerLabel.width + 4);
    this.message.y = actor ? 3 : 2;
    this.resize(this.width, this.height);
  }

  setSpeakers(left: string, right: string, active: string | undefined): void {
    this.twoSpeakers = true;
    this.speakerLabel.fg = SPEAKER_FG;
    this.speakerBox.visible = true;
    this.rightSpeakerBox.visible = true;
    this.speakerLabel.text = left;
    this.rightSpeakerLabel.text = right;
    this.speakerLabel.width = Math.max(1, left.length);
    this.rightSpeakerLabel.width = Math.max(1, right.length);
    this.speakerBox.width = this.speakerLabel.width + 4;
    this.rightSpeakerBox.width = this.rightSpeakerLabel.width + 4;
    this.speakerBox.fg = this.portraitBox.fg = active === left ? ACTIVE_BORDER : INACTIVE_BORDER;
    this.rightSpeakerBox.fg = this.rightPortraitBox.fg = active === right ? ACTIVE_BORDER : INACTIVE_BORDER;
    this.message.y = 3;
    this.resize(this.width, this.height);
  }

  setRightPortrait(asset: PortraitAsset | undefined, frame?: PortraitFrame): void {
    this.rightPortrait = asset;
    this.rightImage.frame = frame;
    this.resize(this.width, this.height);
  }

  protected drawChildren(ctx: DrawContext): void {
    super.drawChildren(ctx);
    this.speakerBox.draw(ctx);
    this.rightSpeakerBox.draw(ctx);
  }

  drawPortrait(ctx: DrawContext, x: number, bottomY: number, side: 'left' | 'right' = 'left'): void {
    const box = side === 'left' ? this.portraitBox : this.rightPortraitBox;
    if (!this.visible || !box.visible) return;
    box.x = x;
    box.y = bottomY - box.height + 1;
    box.draw(ctx);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.portraitBox.visible = this.portrait !== undefined;
    this.rightPortraitBox.visible = this.twoSpeakers && this.rightPortrait !== undefined;
    if (this.portrait) {
      this.portraitBox.width = this.portrait.width + 2;
      this.portraitBox.height = this.portrait.height + 2;
      this.image.width = this.portrait.width;
      this.image.height = this.portrait.height;
    }
    if (this.rightPortrait) {
      this.rightPortraitBox.width = this.rightPortrait.width + 2;
      this.rightPortraitBox.height = this.rightPortrait.height + 2;
      this.rightImage.width = this.rightPortrait.width;
      this.rightImage.height = this.rightPortrait.height;
    }
    this.message.x = this.reservePortraitSpace && this.portrait && (this.twoSpeakers || this.portraitSide === 'left')
      ? Math.min(this.portraitBox.width + 2, Math.max(1, this.innerWidth - 12))
      : 1;
    this.message.width = this.reservePortraitSpace && this.portrait && this.portraitSide === 'right'
      ? Math.max(1, this.innerWidth - this.portraitBox.width - 3)
      : Math.max(1, this.innerWidth - this.message.x - 1);
    this.speakerBox.x = Math.max(0, this.message.x - 1);
    this.rightSpeakerBox.x = Math.max(0, this.width - this.rightSpeakerBox.width);
    this.advanceHint.x = this.message.x;
    this.advanceHint.y = this.message.y + this.message.lines.length + 1;
  }
}
