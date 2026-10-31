import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { defaultPalette, type PaletteDocument } from './palette.js';
import { diagnoseScript, scriptNames, type ScriptDiagnostic } from './rpgscript/diagnose.js';
import {
  CHARACTER_STATES,
  createAnimation,
  importEdAscii,
  parseCharacter,
  isAssetId,
  isInvisibleFrame,
  parseAnimation,
  parsePalette,
  parseProp,
  parseScene,
  parseSprite,
  type AnimationDocument,
  type CharacterDocument,
  type PropDocument,
  type SceneDocument,
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
} from './art/reference.js';
import { encodeStoredSprite, parseStoredSprite } from './art/sprite-storage.js';
import { mergeSprite } from './art/sprite-merge.js';
import {
  isFolderPath,
  parentFolder,
  parseAssetFolders,
  type AssetFolders,
} from './asset-folders.js';
import { SaveConflict, SaveCoordinator, mergeJson, mergeText } from './safe-save.js';

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

  async spriteLabels(): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    for (const id of await this.listSprites()) labels[id] = (await this.readSprite(id)).label;
    return labels;
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
      key: file,
      base,
      doc: draft,
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
      key: this.palettePath(),
      base,
      doc: draft,
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
      key: file,
      base,
      doc: draft,
      validate: (value) => {
        const parsed = parseAnimation(value);
        if (!parsed.ok) throw new AssetError(parsed.error, 422);
        if (parsed.value.id !== id)
          throw new AssetError('Animation id does not match its file', 422);
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
      key: file,
      base,
      doc: draft,
      validate: (value) => {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          (value as ScriptFile).id !== id ||
          typeof (value as ScriptFile).source !== 'string'
        ) {
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
    const file = this.file('sprites', id, '.json');
    await this.saves.run(file, async () => {
      await this.remove(file);
      await this.deleteReference(id, true);
    });
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

  async saveReferenceDraft(id: string, draft: unknown, base: unknown): Promise<SpriteReference> {
    this.requireId(id);
    const file = this.file('references', id, '.json');
    return this.saves.save({
      key: file,
      base,
      doc: draft,
      validate: (value) => {
        const parsed = parseReference(value);
        if (!parsed.ok) throw new AssetError(parsed.error, 422);
        if (parsed.value.id !== id)
          throw new AssetError('Reference id does not match its file', 422);
        return parsed.value;
      },
      read: () => this.readOptional(() => this.readReference(id)),
      write: (value) => this.writeAtomic(file, json(value)),
      merge: mergeJson,
    });
  }

  async deleteReference(id: string, missingOk = false): Promise<void> {
    this.requireId(id);
    await this.saves.run(this.file('references', id, '.json'), () =>
      this.saves.run(this.file('references', id, '.image'), async () => {
        const jsonRemoved = await this.removeIfExists(this.file('references', id, '.json'));
        const imageRemoved = await this.removeReferenceImages(id);
        if (!jsonRemoved && !imageRemoved && !missingOk) {
          throw new AssetError('File not found', 404);
        }
      }),
    );
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

  async saveReferenceImage(
    id: string,
    bytes: Buffer,
    mime = '',
    expected?: string | null,
  ): Promise<{ ext: ReferenceExt; revision: string }> {
    this.requireId(id);
    if (expected === undefined) throw new AssetError('Image upload needs a base revision', 428);
    if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) throw new AssetError('File is too large', 413);
    if (bytes.length === 0) throw new AssetError('Image is empty', 422);
    const ext = detectReferenceImage(bytes, mime);
    if (!ext) throw new AssetError('Reference must be a png, jpeg, webp, or gif image', 422);
    const revision = imageRevision(bytes);
    await this.saves.run(this.file('references', id, '.json'), () =>
      this.saves.run(this.file('references', id, '.image'), async () => {
        const disk = await this.findReferenceImage(id);
        const current = disk ? imageRevision(disk.bytes) : null;
        if (current !== expected && current !== revision) {
          throw new SaveConflict('Reference image changed in another editor; nothing was saved');
        }
        if (current !== revision || disk?.ext !== ext) {
          await this.writeAtomic(this.file('references', id, `.${ext}`), bytes);
          await this.removeReferenceImages(id, ext);
        }
        const meta = await this.readOptional(() => this.readReference(id));
        if (meta && meta.ext !== ext) {
          await this.writeAtomic(this.file('references', id, '.json'), json({ ...meta, ext }));
        }
      }),
    );
    return { ext, revision };
  }

  async listAnimations(): Promise<string[]> {
    return this.listValid('animations', '.json', (text) => parseAnimation(JSON.parse(text)).ok);
  }

  async animationLabels(): Promise<Record<string, string>> {
    const labels: Record<string, string> = {};
    for (const id of await this.listAnimations()) labels[id] = (await this.readAnimation(id)).label;
    return labels;
  }

  private animationFoldersPath(): string {
    return path.join(this.root, 'animation-folders.json');
  }

  async animationFolders(): Promise<AssetFolders> {
    let value: unknown;
    try {
      value = await this.readJson(this.animationFoldersPath());
    } catch (error) {
      if (error instanceof AssetError && error.status === 404)
        return { folders: [], placements: {} };
      throw error;
    }
    const parsed = parseAssetFolders(value);
    if (!parsed) throw new AssetError('Invalid animation folder index', 422);
    return parsed;
  }

  async changeAnimationFolders(
    change:
      | { action: 'create' | 'rename'; folder: string; name: string }
      | { action: 'delete'; folder: string }
      | { action: 'move'; id: string; folder: string },
  ): Promise<AssetFolders> {
    return this.saves.run(this.animationFoldersPath(), async () => {
      const tree = await this.animationFolders();
      if (change.action === 'move') {
        if (change.folder && !tree.folders.includes(change.folder))
          throw new AssetError('Folder not found', 404);
        await this.readAnimation(change.id);
        if (change.folder) tree.placements[change.id] = change.folder;
        else delete tree.placements[change.id];
      } else if (change.action === 'create' || change.action === 'rename') {
        if (!isAssetId(change.name)) throw new AssetError('Use a short lowercase folder name', 400);
        const parent = change.action === 'create' ? change.folder : parentFolder(change.folder);
        if (parent && !tree.folders.includes(parent)) throw new AssetError('Folder not found', 404);
        if (change.action === 'rename' && !tree.folders.includes(change.folder))
          throw new AssetError('Folder not found', 404);
        const next = parent ? `${parent}/${change.name}` : change.name;
        if (!isFolderPath(next)) throw new AssetError('Folder path is too long', 400);
        if (change.action === 'rename' && next === change.folder) return tree;
        if (tree.folders.includes(next)) throw new AssetError('Folder already exists', 409);
        if (change.action === 'create') tree.folders.push(next);
        else {
          const replace = (folder: string) =>
            folder === change.folder || folder.startsWith(`${change.folder}/`)
              ? next + folder.slice(change.folder.length)
              : folder;
          if (tree.folders.some((folder) => replace(folder).length > 256))
            throw new AssetError('Folder path is too long', 400);
          tree.folders = tree.folders.map(replace);
          for (const [id, folder] of Object.entries(tree.placements))
            tree.placements[id] = replace(folder);
        }
      } else {
        if (!tree.folders.includes(change.folder)) throw new AssetError('Folder not found', 404);
        if (
          tree.folders.some((folder) => parentFolder(folder) === change.folder) ||
          Object.values(tree.placements).includes(change.folder)
        )
          throw new AssetError('Move assets and subfolders out before deleting this folder', 409);
        tree.folders = tree.folders.filter((folder) => folder !== change.folder);
      }
      await this.writeAtomic(this.animationFoldersPath(), json(tree));
      return tree;
    });
  }

  async createCharacterAnimations(
    parent: string,
    name: string,
    spriteId: string,
  ): Promise<{ folder: string; ids: string[] }> {
    if (!isAssetId(name)) throw new AssetError('Use a short lowercase folder name', 400);
    this.requireId(spriteId);
    const folder = parent ? `${parent}/${name}` : name;
    if (!isFolderPath(folder)) throw new AssetError('Folder path is too long', 400);
    const ids = CHARACTER_STATES.map(() => randomUUID());
    const sprite = await this.readSprite(spriteId);
    if (sprite.sprites.length === 0) throw new AssetError('Sprite sheet has no frames', 422);
    const files = ids.map((id) => this.file('animations', id, '.json'));
    const withLocks = async <T>(index: number, operation: () => Promise<T>): Promise<T> =>
      index === files.length
        ? operation()
        : this.saves.run(files[index], () => withLocks(index + 1, operation));
    return withLocks(0, () =>
      this.saves.run(this.animationFoldersPath(), async () => {
        const tree = await this.animationFolders();
        if (parent && !tree.folders.includes(parent)) throw new AssetError('Folder not found', 404);
        if (tree.folders.includes(folder)) throw new AssetError('Folder already exists', 409);
        for (const file of files) await this.ensureAbsent(file);
        const created: string[] = [];
        try {
          for (const [index, id] of ids.entries()) {
            const animation = createAnimation(id, `${name} ${CHARACTER_STATES[index].replace('-', ' ')}`);
            animation.frames.push({
              sprite: spriteId,
              index: 0,
              durationMs: animation.defaultDurationMs,
            });
            await this.writeAtomic(files[index], json(animation));
            created.push(files[index]);
          }
          tree.folders.push(folder);
          for (const id of ids) tree.placements[id] = folder;
          await this.writeAtomic(this.animationFoldersPath(), json(tree));
        } catch (error) {
          for (const file of created) await this.removeIfExists(file);
          throw error;
        }
        return { folder, ids };
      }),
    );
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
    const file = this.file('animations', id, '.json');
    await this.saves.run(file, async () => {
      await this.remove(file);
      await this.saves.run(this.animationFoldersPath(), async () => {
        const tree = await this.animationFolders();
        if (tree.placements[id]) {
          delete tree.placements[id];
          await this.writeAtomic(this.animationFoldersPath(), json(tree));
        }
      });
    });
  }

  async copyAnimation(from: string, id: string, draft: unknown): Promise<AnimationDocument> {
    this.requireId(from);
    this.requireId(id);
    if (from === id) throw new AssetError('Choose a different id', 400);
    const source = this.file('animations', from, '.json');
    return this.saves.run(source, async () => {
      await this.readAnimation(from);
      const copy = await this.saveAnimationDraft(id, draft, null);
      await this.saves.run(this.animationFoldersPath(), async () => {
        const tree = await this.animationFolders();
        const folder = tree.placements[from];
        if (folder) {
          tree.placements[id] = folder;
          await this.writeAtomic(this.animationFoldersPath(), json(tree));
        }
      });
      return copy;
    });
  }

  async renameAnimation(from: string, id: string, base: unknown): Promise<AnimationDocument> {
    this.requireId(from);
    this.requireId(id);
    const original = this.file('animations', from, '.json');
    const destination = this.file('animations', id, '.json');
    if (from === id) throw new AssetError('Choose a different id', 400);
    return this.saves.run(original, () =>
      this.saves.run(destination, async () => {
        const animation = await this.readAnimation(from);
        if (JSON.stringify(animation) !== JSON.stringify(base)) {
          throw new SaveConflict('Animation changed in another editor; nothing was renamed');
        }
        await this.ensureAbsent(destination);
        const renamed = { ...animation, id };
        await this.writeAtomic(destination, json(renamed));
        await this.remove(original);
        await this.saves.run(this.animationFoldersPath(), async () => {
          const tree = await this.animationFolders();
          if (tree.placements[from]) {
            tree.placements[id] = tree.placements[from];
            delete tree.placements[from];
            await this.writeAtomic(this.animationFoldersPath(), json(tree));
          }
        });
        return renamed;
      }),
    );
  }

  async listProps(): Promise<string[]> {
    return this.listValid('props', '.json', (text) => parseProp(JSON.parse(text)).ok);
  }

  async readProp(id: string): Promise<PropDocument> {
    const parsed = parseProp(await this.readJson(this.file('props', id, '.json')));
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Prop id does not match its file', 422);
    return parsed.value;
  }

  async savePropDraft(id: string, draft: unknown, base: unknown): Promise<PropDocument> {
    this.requireId(id);
    const file = this.file('props', id, '.json');
    return this.saves.save({
      key: file,
      base,
      doc: draft,
      validate: (value) => {
        const parsed = parseProp(value);
        if (!parsed.ok) throw new AssetError(parsed.error, 422);
        if (parsed.value.id !== id) throw new AssetError('Prop id does not match its file', 422);
        return parsed.value;
      },
      read: () => this.readOptional(() => this.readProp(id)),
      write: async (value) => {
        if (value.visual.type === 'sprite') {
          if (!(await this.listSprites()).includes(value.visual.id)) {
            throw new AssetError(`Prop references missing sprite "${value.visual.id}"`, 422);
          }
          const sprite = await this.readSprite(value.visual.id);
          if (value.visual.index >= sprite.sprites.length) {
            throw new AssetError('Prop references a missing sprite frame', 422);
          }
        } else if (!(await this.listAnimations()).includes(value.visual.id)) {
          throw new AssetError(`Prop references missing animation "${value.visual.id}"`, 422);
        }
        await this.writeAtomic(file, json(value));
      },
      merge: mergeJson,
    });
  }

  async deleteProp(id: string): Promise<void> {
    const file = this.file('props', id, '.json');
    await this.saves.run(file, () => this.remove(file));
  }

  async listCharacters(): Promise<string[]> {
    return this.listValid('characters', '.json', (text) => parseCharacter(JSON.parse(text)).ok);
  }

  async readCharacter(id: string): Promise<CharacterDocument> {
    const parsed = parseCharacter(await this.readJson(this.file('characters', id, '.json')));
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Character id does not match its file', 422);
    return parsed.value;
  }

  async saveCharacterDraft(id: string, draft: unknown, base: unknown): Promise<CharacterDocument> {
    this.requireId(id);
    const file = this.file('characters', id, '.json');
    return this.saves.save({
      key: file,
      base,
      doc: draft,
      validate: (value) => {
        const parsed = parseCharacter(value);
        if (!parsed.ok) throw new AssetError(parsed.error, 422);
        if (parsed.value.id !== id)
          throw new AssetError('Character id does not match its file', 422);
        return parsed.value;
      },
      read: () => this.readOptional(() => this.readCharacter(id)),
      write: async (value) => {
        const available = new Set(await this.listAnimations());
        for (const animation of [
          ...Object.values(value.animations),
          ...Object.values(value.customAnimations),
        ]) {
          if (!available.has(animation))
            throw new AssetError(`Character references missing animation "${animation}"`, 422);
        }
        await this.writeAtomic(file, json(value));
      },
      merge: mergeJson,
    });
  }

  async deleteCharacter(id: string): Promise<void> {
    const file = this.file('characters', id, '.json');
    await this.saves.run(file, () => this.remove(file));
  }

  async listScenes(): Promise<string[]> {
    return this.listValid('scenes', '.json', (text) => parseScene(JSON.parse(text)).ok);
  }

  async readScene(id: string): Promise<SceneDocument> {
    const parsed = parseScene(await this.readJson(this.file('scenes', id, '.json')));
    if (!parsed.ok) throw new AssetError(parsed.error, 422);
    if (parsed.value.id !== id) throw new AssetError('Scene id does not match its file', 422);
    return parsed.value;
  }

  async saveSceneDraft(id: string, draft: unknown, base: unknown): Promise<SceneDocument> {
    this.requireId(id);
    const file = this.file('scenes', id, '.json');
    return this.saves.save({
      key: file,
      base,
      doc: draft,
      validate: (value) => {
        const parsed = parseScene(value);
        if (!parsed.ok) throw new AssetError(parsed.error, 422);
        if (parsed.value.id !== id) throw new AssetError('Scene id does not match its file', 422);
        return parsed.value;
      },
      read: () => this.readOptional(() => this.readScene(id)),
      write: async (value) => {
        for (const entity of value.entities) {
          if (entity.type === 'Background' || 'sprite' in entity) {
            let sprite: SpriteDocument | null = null;
            try {
              sprite = await this.readSprite(entity.sprite);
            } catch (error) {
              // The hand-authored test-room crate predates the editor sprite format.
              if (entity.type !== 'Prop' || !(error instanceof AssetError) || error.status !== 422)
                throw error;
              const legacy = await this.readJson(this.file('sprites', entity.sprite, '.json'));
              if (
                !legacy ||
                typeof legacy !== 'object' ||
                (legacy as { id?: unknown }).id !== entity.sprite ||
                (legacy as { format?: unknown }).format !== 'incanterm-sprite'
              )
                throw error;
            }
            if (entity.type === 'Background' && sprite && entity.index >= sprite.sprites.length)
              throw new AssetError(`Background ${entity.id} references missing frame`, 422);
          } else {
            const prop = await this.readProp(entity.prop);
            if (prop.visual.type === 'sprite') {
              const sprite = await this.readSprite(prop.visual.id);
              if (prop.visual.index >= sprite.sprites.length)
                throw new AssetError(`Prop ${entity.id} references missing frame`, 422);
            } else await this.readAnimation(prop.visual.id);
          }
        }
        await this.writeAtomic(file, json(value));
      },
      merge: mergeJson,
    });
  }

  async deleteScene(id: string): Promise<void> {
    const file = this.file('scenes', id, '.json');
    await this.saves.run(file, () => this.remove(file));
  }

  async listScripts(): Promise<string[]> {
    return this.listNames('scripts', '.rpgscript');
  }

  async listRpgTriggers(): Promise<string[]> {
    const names = new Set<string>();
    for (const id of await this.listScripts()) {
      const { source } = await this.readScript(id);
      for (const line of source.split(/\r?\n/)) {
        const match = /^\s*#([\w-]+)\s*$/.exec(line);
        if (match) names.add(match[1]);
      }
    }
    return [...names].sort();
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
    const file = this.file('scripts', id, '.rpgscript');
    await this.saves.run(file, () => this.remove(file));
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
    label?: string,
  ): Promise<SpriteDocument | AnimationDocument | ScriptFile> {
    this.requireId(id);
    if (kind === 'sprite') {
      const sprite = await this.readSprite(from);
      await this.ensureAbsent(this.file('sprites', id, '.json'));
      const saved = await this.saveSpriteDraft(id, { ...sprite, id, label: label ?? sprite.label }, null);
      await this.copyReference(from, id);
      return saved;
    }
    if (kind === 'animation') {
      const animation = await this.readAnimation(from);
      await this.ensureAbsent(this.file('animations', id, '.json'));
      return this.saveAnimationDraft(id, { ...animation, id }, null);
    }
    if (kind === 'script') {
      const script = await this.readScript(from);
      await this.ensureAbsent(this.file('scripts', id, '.rpgscript'));
      return this.saveScriptDraft(id, { id, source: script.source }, null);
    }
    throw new AssetError('Unknown asset kind', 400);
  }

  async importEdAscii(id: string, document: unknown, label?: string): Promise<SpriteDocument> {
    this.requireId(id);
    const imported = importEdAscii(id, document);
    if (!imported.ok) throw new AssetError(imported.error, 422);
    await this.ensureAbsent(this.file('sprites', id, '.json'));
    return this.saveSpriteDraft(id, { ...imported.value, label: label ?? id }, null);
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
    try {
      return await read();
    } catch (error) {
      if (error instanceof AssetError && error.status === 404) return null;
      throw error;
    }
  }

  private async writeAtomic(file: string, text: string | Buffer): Promise<void> {
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
    if (meta) {
      await this.saveReferenceDraft(id, { ...meta, id, ext: image?.ext ?? meta.ext }, null);
    }
    if (image) await this.saveReferenceImage(id, image.bytes, referenceMime(image.ext), null);
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

export function imageRevision(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
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
