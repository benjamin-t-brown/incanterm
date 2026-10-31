import type { PortraitAsset, PortraitFrame } from '../../game/portrait-assets.js';
import { BorderBox } from './border-box.js';
import { UIElement, type DrawContext } from './element.js';
import { ParagraphWrapped } from './paragraph-wrapped.js';

const FG = { r: 205, g: 211, b: 209 };
const BG = { r: 16, g: 20, b: 25 };

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
  readonly portraitBox: BorderBox;
  private readonly image: PortraitImage;
  private portrait: PortraitAsset | undefined;

  constructor(id: string, x: number, y: number, width: number, height: number) {
    super(id, x, y, width, height, { border: 'double', fg: FG, bg: BG });
    this.portraitBox = new BorderBox(`${id}-portrait`, 1, 1, 6, Math.max(2, height - 2), {
      border: 'single',
      fg: FG,
      bg: BG,
      visible: false,
    });
    this.image = new PortraitImage(`${id}-image`, 0, 0, 4, Math.max(1, height - 4));
    this.portraitBox.addChild(this.image);
    this.message = new ParagraphWrapped(`${id}-message`, 1, 2, width - 4, '', {
      fg: FG,
      bg: BG,
    });
    this.addChild(this.portraitBox);
    this.addChild(this.message);
    this.resize(width, height);
  }

  setPortrait(asset: PortraitAsset | undefined, frame?: PortraitFrame): void {
    this.portrait = asset;
    this.image.frame = frame;
    this.resize(this.width, this.height);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.portraitBox.visible = this.portrait !== undefined;
    if (this.portrait) {
      this.portraitBox.width = Math.min(
        this.portrait.width + 2,
        Math.max(6, Math.floor(this.innerWidth * 0.42)),
        this.innerWidth - 12,
      );
      this.portraitBox.height = this.innerHeight;
      this.image.width = this.portraitBox.innerWidth;
      this.image.height = this.portraitBox.innerHeight;
      this.message.x = this.portraitBox.width + 2;
      this.message.width = Math.max(1, this.innerWidth - this.message.x - 1);
    } else {
      this.message.x = 1;
      this.message.width = Math.max(1, this.innerWidth - 2);
    }
  }
}
