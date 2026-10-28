import fs from 'node:fs/promises';
import path from 'node:path';
import { defaultPalette, type PaletteDocument } from './palette.js';
import { diagnoseScript, scriptNames, type ScriptDiagnostic } from './rpgscript/diagnose.js';
import {
  importEdAscii,
  isAssetId,
  parseAnimation,
  parsePalette,
  parseSprite,
  type AnimationDocument,
  type SpriteDocument,
} from './schema.js';

export class AssetError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type ScriptFile = {
  id: string;
  source: string;
};

export type AudioFile = {
  id: string;
  name: string;
};

const AUDIO_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(wav|ogg|mp3)$/i;

export class AssetStore {
  constructor(readonly root: string) {}

  async palette(): Promise<PaletteDocument> {
    const file = this.palettePath();
    try {
      return this.readPalette(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (!isNotFound(error)) throw error;
      const palette = defaultPalette();
      await this.writeText(file, json(palette));
      return palette;
    }
  }

  async savePalette(value: unknown): Promise<PaletteDocument> {
    const parsed = parsePalette(value);
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    await this.writeText(this.palettePath(), json(parsed.value));
    return parsed.value;
  }

  async listSprites(): Promise<string[]> {
    return this.listValid('sprites', '.json', (text) => parseSprite(JSON.parse(text)).ok);
  }

  async readSprite(id: string): Promise<SpriteDocument> {
    const parsed = parseSprite(await this.readJson(this.file('sprites', id, '.json')));
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Sprite id does not match its file', 422);
    return parsed.value;
  }

  async saveSprite(id: string, value: unknown): Promise<SpriteDocument> {
    this.requireId(id);
    const parsed = parseSprite(value);
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Sprite id does not match its file', 422);
    await this.writeText(this.file('sprites', id, '.json'), json(parsed.value));
    return parsed.value;
  }

  async deleteSprite(id: string): Promise<void> {
    await this.remove(this.file('sprites', id, '.json'));
  }

  async listAnimations(): Promise<string[]> {
    return this.listValid('animations', '.json', (text) => parseAnimation(JSON.parse(text)).ok);
  }

  async readAnimation(id: string): Promise<AnimationDocument> {
    const parsed = parseAnimation(await this.readJson(this.file('animations', id, '.json')));
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Animation id does not match its file', 422);
    return parsed.value;
  }

  async saveAnimation(id: string, value: unknown): Promise<AnimationDocument> {
    this.requireId(id);
    const parsed = parseAnimation(value);
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Animation id does not match its file', 422);
    const sprites = new Set(await this.listSprites());
    const missing = parsed.value.frames.filter((frame) => !sprites.has(frame.sprite));
    if (missing.length > 0) {
      throw new AssetError(`Animation references missing sprite "${missing[0].sprite}"`, 422);
    }
    await this.writeText(this.file('animations', id, '.json'), json(parsed.value));
    return parsed.value;
  }

  async deleteAnimation(id: string): Promise<void> {
    await this.remove(this.file('animations', id, '.json'));
  }

  async listScripts(): Promise<string[]> {
    return this.listNames('scripts', '.rpgscript');
  }

  async readScript(id: string): Promise<ScriptFile> {
    return {
      id: this.requireId(id),
      source: await this.readText(this.file('scripts', id, '.rpgscript')),
    };
  }

  async saveScript(id: string, source: unknown): Promise<ScriptFile> {
    this.requireId(id);
    if (typeof source !== 'string') throw new AssetError('Script source must be text', 422);
    if (source.length > 1_000_000) throw new AssetError('Script is too large', 413);
    await this.writeText(this.file('scripts', id, '.rpgscript'), source);
    return { id, source };
  }

  async deleteScript(id: string): Promise<void> {
    await this.remove(this.file('scripts', id, '.rpgscript'));
  }

  async diagnose(id: string, source: string): Promise<ScriptDiagnostic[]> {
    this.requireId(id);
    const names = new Set<string>();
    for (const scriptId of await this.listScripts()) {
      const text = scriptId === id ? source : (await this.readScript(scriptId)).source;
      for (const name of scriptNames(text)) names.add(name);
    }
    if (!(await this.exists(this.file('scripts', id, '.rpgscript')))) {
      for (const name of scriptNames(source)) names.add(name);
    }
    return diagnoseScript(source, [...names]);
  }

  async listAudio(): Promise<AudioFile[]> {
    const directory = path.join(this.root, 'audio');
    let entries: string[];
    try {
      entries = await fs.readdir(directory);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    return entries
      .filter((name) => AUDIO_NAME.test(name))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ id: name.slice(0, name.lastIndexOf('.')), name }));
  }

  async readAudio(name: string): Promise<{ type: string; bytes: Buffer }> {
    if (!AUDIO_NAME.test(name) || name.includes('..')) {
      throw new AssetError('Unknown audio file', 400);
    }
    const file = path.resolve(this.root, 'audio', name);
    this.assertInside(path.resolve(this.root, 'audio'), file);
    try {
      return { type: audioType(name), bytes: await fs.readFile(file) };
    } catch (error) {
      if (isNotFound(error)) throw new AssetError('Audio file not found', 404);
      throw error;
    }
  }

  async duplicate(
    kind: 'sprite' | 'animation' | 'script',
    from: string,
    id: string,
  ): Promise<SpriteDocument | AnimationDocument | ScriptFile> {
    this.requireId(id);
    if (kind === 'sprite') {
      const sprite = await this.readSprite(from);
      await this.ensureAbsent(this.file('sprites', id, '.json'));
      return this.saveSprite(id, { ...sprite, id });
    }
    if (kind === 'animation') {
      const animation = await this.readAnimation(from);
      await this.ensureAbsent(this.file('animations', id, '.json'));
      return this.saveAnimation(id, { ...animation, id });
    }
    if (kind === 'script') {
      const script = await this.readScript(from);
      await this.ensureAbsent(this.file('scripts', id, '.rpgscript'));
      return this.saveScript(id, script.source);
    }
    throw new AssetError('Unknown asset kind', 400);
  }

  async importEdAscii(id: string, document: unknown): Promise<SpriteDocument> {
    this.requireId(id);
    const imported = importEdAscii(id, document);
    if (!imported.ok) throw new AssetError(imported.error, 422);
    await this.ensureAbsent(this.file('sprites', id, '.json'));
    return this.saveSprite(id, imported.value);
  }

  private requireId(id: string): string {
    if (!isAssetId(id)) throw new AssetError('Use a short lowercase id', 400);
    return id;
  }

  private file(folder: string, id: string, extension: string): string {
    this.requireId(id);
    const directory = path.resolve(this.root, folder);
    const file = path.resolve(directory, `${id}${extension}`);
    this.assertInside(directory, file);
    return file;
  }

  private palettePath(): string {
    return path.join(this.root, 'palette.json');
  }

  private assertInside(directory: string, file: string): void {
    const relative = path.relative(directory, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AssetError('Path is outside the asset folder', 400);
    }
  }

  private async listNames(folder: string, extension: string): Promise<string[]> {
    const directory = path.join(this.root, folder);
    let entries: string[];
    try {
      entries = await fs.readdir(directory);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    return entries
      .filter((name) => name.endsWith(extension))
      .map((name) => name.slice(0, -extension.length))
      .filter((id) => isAssetId(id))
      .sort((a, b) => a.localeCompare(b));
  }

  private async listValid(
    folder: string,
    extension: string,
    valid: (text: string) => boolean,
  ): Promise<string[]> {
    const ids = await this.listNames(folder, extension);
    const accepted: string[] = [];
    for (const id of ids) {
      try {
        const text = await fs.readFile(this.file(folder, id, extension), 'utf8');
        if (valid(text)) accepted.push(id);
      } catch {
        continue;
      }
    }
    return accepted;
  }

  private readPalette(text: string): PaletteDocument {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new AssetError('Palette file is invalid JSON', 422);
    }
    const parsed = parsePalette(value);
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    return parsed.value;
  }

  private async readJson(file: string): Promise<unknown> {
    const text = await this.readText(file);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AssetError('Invalid JSON', 400);
    }
  }

  private async readText(file: string): Promise<string> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch (error) {
      if (isNotFound(error)) throw new AssetError('File not found', 404);
      throw error;
    }
  }

  private async writeText(file: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, text, 'utf8');
    await fs.copyFile(temporary, file);
    await fs.unlink(temporary);
  }

  private async remove(file: string): Promise<void> {
    try {
      await fs.unlink(file);
    } catch (error) {
      if (isNotFound(error)) throw new AssetError('File not found', 404);
      throw error;
    }
  }

  private async ensureAbsent(file: string): Promise<void> {
    if (await this.exists(file)) throw new AssetError('An asset with that id already exists', 409);
  }

  private async exists(file: string): Promise<boolean> {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function audioType(name: string): string {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.ogg') return 'audio/ogg';
  return 'audio/mpeg';
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
