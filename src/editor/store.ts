import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { defaultPalette, type PaletteDocument } from './palette.js';
import { diagnoseScript, scriptNames, type ScriptDiagnostic } from './rpgscript/diagnose.js';
import {
  importEdAscii,
  isAssetId,
  isInvisibleFrame,
  parseAnimation,
  parsePalette,
  parseSprite,
  type AnimationDocument,
  type SpriteDocument,
} from './schema.js';
import {
  detectReferenceImage,
  MAX_REFERENCE_IMAGE_BYTES,
  parseReference,
  REFERENCE_EXTS,
  referenceMime,
  type ReferenceExt,
  type SpriteReference,
} from './reference.js';
import { encodeStoredSprite, parseStoredSprite } from './sprite-storage.js';
import { mergeSprite } from './sprite-merge.js';
import { SaveCoordinator, mergeJson, mergeText } from './safe-save.js';

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
  private readonly saves = new SaveCoordinator();

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
    return this.listValid('sprites', '.json', (text) => parseStoredSprite(JSON.parse(text)).ok);
  }

  async readSprite(id: string): Promise<SpriteDocument> {
    const parsed = parseStoredSprite(await this.readJson(this.file('sprites', id, '.json')));
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Sprite id does not match its file', 422);
    return parsed.value;
  }

  async saveSprite(id: string, value: unknown): Promise<SpriteDocument> {
    this.requireId(id);
    const parsed = parseSprite(value);
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Sprite id does not match its file', 422);
    await this.writeText(this.file('sprites', id, '.json'), encodeStoredSprite(parsed.value));
    return parsed.value;
  }

  async saveSpriteDraft(id: string, draft: unknown, base: unknown): Promise<SpriteDocument> {
    this.requireId(id);
    const file = this.file('sprites', id, '.json');
    return this.saves.save({
      key: file, base, doc: draft,
      validate: (value) => {
        const parsed = parseSprite(value);
        if (!parsed.ok) throw new AssetError(parsed.error, 422);
        if (parsed.value.id !== id) throw new AssetError('Sprite id does not match its file', 422);
        return parsed.value;
      },
      read: () => this.readOptional(() => this.readSprite(id)),
      write: (value) => this.writeAtomic(file, encodeStoredSprite(value)),
      merge: mergeSprite,
    });
  }

  async savePaletteDraft(draft: unknown, base: unknown): Promise<PaletteDocument> {
    return this.saves.save({
      key: this.palettePath(), base, doc: draft,
      validate: (value) => {
        const parsed = parsePalette(value);
        if (!parsed.ok) throw new AssetError(parsed.error, 422);
        return parsed.value;
      },
      read: () => this.palette(),
      write: (value) => this.writeAtomic(this.palettePath(), json(value)),
      merge: mergeJson,
    });
  }

  async saveAnimationDraft(id: string, draft: unknown, base: unknown): Promise<AnimationDocument> {
    this.requireId(id);
    const file = this.file('animations', id, '.json');
    return this.saves.save({
      key: file, base, doc: draft,
      validate: (value) => {
        const parsed = parseAnimation(value);
        if (!parsed.ok) throw new AssetError(parsed.error, 422);
        if (parsed.value.id !== id) throw new AssetError('Animation id does not match its file', 422);
        return parsed.value;
      },
      read: () => this.readOptional(() => this.readAnimation(id)),
      write: async (value) => {
        await this.checkAnimationReferences(value);
        await this.writeAtomic(file, json(value));
      },
      merge: mergeJson,
    });
  }

  async saveScriptDraft(id: string, draft: unknown, base: unknown): Promise<ScriptFile> {
    this.requireId(id);
    const file = this.file('scripts', id, '.rpgscript');
    return this.saves.save({
      key: file, base, doc: draft,
      validate: (value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            (value as ScriptFile).id !== id || typeof (value as ScriptFile).source !== 'string') {
          throw new AssetError('Script needs a matching id and source', 422);
        }
        const source = (value as ScriptFile).source;
        if (source.length > 1_000_000) throw new AssetError('Script is too large', 413);
        return { id, source };
      },
      read: () => this.readOptional(() => this.readScript(id)),
      write: (value) => this.writeAtomic(file, value.source),
      merge: (old, local, remote) => {
        const merged = mergeText(old.source, local.source, remote.source);
        return merged.ok ? { ok: true, value: { id, source: merged.value } } : merged;
      },
    });
  }

  async deleteSprite(id: string): Promise<void> {
    await this.remove(this.file('sprites', id, '.json'));
    await this.deleteReference(id, true);
  }

  async readReference(id: string): Promise<SpriteReference> {
    const parsed = parseReference(await this.readJson(this.file('references', id, '.json')));
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Reference id does not match its file', 422);
    return parsed.value;
  }

  async saveReference(id: string, value: unknown): Promise<SpriteReference> {
    this.requireId(id);
    const parsed = parseReference(value);
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Reference id does not match its file', 422);
    await this.writeText(this.file('references', id, '.json'), json(parsed.value));
    return parsed.value;
  }

  async deleteReference(id: string, missingOk = false): Promise<void> {
    this.requireId(id);
    const jsonRemoved = await this.removeIfExists(this.file('references', id, '.json'));
    const imageRemoved = await this.removeReferenceImages(id);
    if (!jsonRemoved && !imageRemoved && !missingOk) {
      throw new AssetError('File not found', 404);
    }
  }

  async readReferenceImage(
    id: string,
  ): Promise<{ type: string; ext: ReferenceExt; bytes: Buffer }> {
    this.requireId(id);
    const found = await this.findReferenceImage(id);
    if (!found) throw new AssetError('File not found', 404);
    return {
      type: referenceMime(found.ext),
      ext: found.ext,
      bytes: found.bytes,
    };
  }

  async saveReferenceImage(id: string, bytes: Buffer, mime = ''): Promise<{ ext: ReferenceExt }> {
    this.requireId(id);
    if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) throw new AssetError('File is too large', 413);
    if (bytes.length === 0) throw new AssetError('Image is empty', 422);
    const ext = detectReferenceImage(bytes, mime);
    if (!ext) throw new AssetError('Reference must be a png, jpeg, webp, or gif image', 422);
    await this.removeReferenceImages(id, ext);
    await this.writeBytes(this.file('references', id, `.${ext}`), bytes);
    try {
      const meta = await this.readReference(id);
      if (meta.ext !== ext) await this.saveReference(id, { ...meta, ext });
    } catch (error) {
      if (!(error instanceof AssetError) || error.status !== 404) throw error;
    }
    return { ext };
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
    await this.checkAnimationReferences(parsed.value);
    await this.writeText(this.file('animations', id, '.json'), json(parsed.value));
    return parsed.value;
  }

  private async checkAnimationReferences(animation: AnimationDocument): Promise<void> {
    const sprites = new Set(await this.listSprites());
    const missing = animation.frames.find(
      (frame) => !isInvisibleFrame(frame) && !sprites.has(frame.sprite),
    );
    if (missing && !isInvisibleFrame(missing)) {
      throw new AssetError(`Animation references missing sprite "${missing.sprite}"`, 422);
    }
    const sheets = new Map<string, SpriteDocument>();
    for (const frame of animation.frames) {
      if (isInvisibleFrame(frame)) continue;
      let sheet = sheets.get(frame.sprite);
      if (!sheet) {
        sheet = await this.readSprite(frame.sprite);
        sheets.set(frame.sprite, sheet);
      }
      if (frame.index >= sheet.sprites.length) {
        throw new AssetError(
          `Animation frame references missing sprite ${frame.sprite} index ${frame.index}`,
          422,
        );
      }
    }
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
      const saved = await this.saveSprite(id, { ...sprite, id });
      await this.copyReference(from, id);
      return saved;
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
    await this.writeBytes(file, Buffer.from(text, 'utf8'));
  }

  private async readOptional<T>(read: () => Promise<T>): Promise<T | null> {
    try { return await read(); }
    catch (error) {
      if (error instanceof AssetError && error.status === 404) return null;
      throw error;
    }
  }

  private async writeAtomic(file: string, text: string): Promise<void> {
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.writeFile(temporary, text);
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }

  private async writeBytes(file: string, bytes: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await fs.writeFile(temporary, bytes);
    await fs.copyFile(temporary, file);
    await fs.unlink(temporary);
  }

  private async copyReference(from: string, id: string): Promise<void> {
    let meta: SpriteReference | null = null;
    try {
      meta = await this.readReference(from);
    } catch (error) {
      if (!(error instanceof AssetError) || error.status !== 404) throw error;
    }
    const image = await this.findReferenceImage(from);
    if (!meta && !image) return;
    if (image) await this.writeBytes(this.file('references', id, `.${image.ext}`), image.bytes);
    if (meta) {
      await this.writeText(
        this.file('references', id, '.json'),
        json({ ...meta, id, ext: image?.ext ?? meta.ext }),
      );
    }
  }

  private async findReferenceImage(
    id: string,
  ): Promise<{ ext: ReferenceExt; file: string; bytes: Buffer } | null> {
    let preferred: ReferenceExt | undefined;
    try {
      preferred = (await this.readReference(id)).ext;
    } catch (error) {
      if (!(error instanceof AssetError) || error.status !== 404) throw error;
    }
    const order = preferred
      ? [preferred, ...REFERENCE_EXTS.filter((ext) => ext !== preferred)]
      : [...REFERENCE_EXTS];
    for (const ext of order) {
      const file = this.file('references', id, `.${ext}`);
      try {
        return { ext, file, bytes: await fs.readFile(file) };
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    return null;
  }

  private async removeReferenceImages(id: string, keep?: ReferenceExt): Promise<boolean> {
    let removed = false;
    for (const ext of REFERENCE_EXTS) {
      if (ext === keep) continue;
      if (await this.removeIfExists(this.file('references', id, `.${ext}`))) removed = true;
    }
    return removed;
  }

  private async remove(file: string): Promise<void> {
    if (!(await this.removeIfExists(file))) throw new AssetError('File not found', 404);
  }

  private async removeIfExists(file: string): Promise<boolean> {
    try {
      await fs.unlink(file);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
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
