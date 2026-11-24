import { ScriptParser, type Command } from '../../../game/rpgscript/parser.js';
import {
  hasDialoguePlaceholder,
  parseDialogueArgs,
} from '../../../game/scene-command-support/dialogue.js';
import { isVoiceLineId } from '../../../voice/contracts.js';

const quoted = `(?:"[^"]*"|'[^']*')`;
const token = `(?:${quoted}|[\\w.-]+)`;
// Deliberately narrower than RPGScript: change only a standalone call whose argument
// boundaries are unambiguous. The parser below remains authoritative about meaning.
const plainCall = new RegExp(
  `^(\\s*\\+?\\s*playDialogue\\s*\\(\\s*${token}\\s*,\\s*${quoted}(?:\\s*,\\s*${token}){0,2})(\\s*,\\s*(?:"no-voice"|'no-voice'|no-voice))?(\\s*\\)\\s*;?\\s*)$`,
);
const plainShorthand = new RegExp(
  `^(\\s*\\+?\\s*[A-Za-z][\\w. -]*(?:&[\\w-]+)?:\\s*${quoted})(?:[ \\t]*//[ \\t]*(?:no-voice|voice)(?:[ \\t]+[\\w-]+)?)?([ \\t]*\\r?)$`,
);

function getDialogueCommands(parsed: ReturnType<ScriptParser['parse']>, first: number, last: number) {
  const selected = new Map<number, Command>();
  for (const script of Object.values(parsed.scripts)) {
    for (const block of script.blocks) {
      for (const command of block.commands)
        if (command.type === 'playDialogue' && command.i >= first && command.i <= last)
          selected.set(command.i, command);
    }
  }
  return selected;
}

/** Reparse both versions so a rewrite cannot silently change a conditional, literal or speaker. */
export function rewriteVoiceRequest(
  source: string,
  line: number,
  requested: boolean,
  createId: () => string = () => `v_${crypto.randomUUID()}`,
): string {
  const result = setSelectedVoiceRequests(source, line, line, requested, createId);
  if (result.skipped.length) throw new Error(result.skipped[0].reason);
  return result.source;
}

export function setSelectedVoiceRequests(source: string, first: number, last: number, requested: boolean,
  createId: () => string = () => `v_${crypto.randomUUID()}`) {
  const pending = new Set<number>();
  const parser = new ScriptParser('<draft>', (line) => {
    pending.add(line);
    return 'v_pending';
  });
  const original = parser.parse(source);
  const selected = getDialogueCommands(original, first, last);
  if (!selected.size) throw new Error('Place the cursor on dialogue or select lines containing dialogue.');
  const lines = source.split('\n');
  const changed = new Map<number, string>();
  const skipped: { line: number; reason: string }[] = [];
  for (const [line, command] of selected) {
    const dialogue = parseDialogueArgs(command.args);
    const explicit = plainCall.exec(lines[line - 1]);
    const shorthand = plainShorthand.exec(lines[line - 1]);
    if (!dialogue || (!explicit && !shorthand) || hasDialoguePlaceholder(dialogue.actor) || hasDialoguePlaceholder(dialogue.text)) {
      skipped.push({ line, reason: 'Only standalone dialogue with a literal speaker and text can be changed.' });
      continue;
    }
    const { voice } = dialogue;
    if ((voice?.requested ?? false) === requested && !pending.has(line)) continue;
    const lineId = pending.has(line) ? createId() : voice?.lineId ?? createId();
    if (!isVoiceLineId(lineId)) throw new Error('Invalid voice line ID.');
    changed.set(line, lineId);
    if (explicit) {
      const metadata = voice ? '' : `${command.args.length === 2 ? ', ""' : ''}, "${lineId}"`;
      lines[line - 1] = `${explicit[1]}${metadata}${requested ? '' : ', "no-voice"'}${explicit[3]}`;
    } else if (shorthand) {
      lines[line - 1] = `${shorthand[1]} // ${requested ? 'voice' : 'no-voice'} ${lineId}${shorthand[2]}`;
    }
  }
  if (!changed.size) return { source, skipped, count: 0 };
  const rewritten = lines.join('\n');
  const next = parser.parse(rewritten);
  const updated = getDialogueCommands(next, first, last);
  for (const [line, id] of changed) {
    const before = selected.get(line);
    const after = updated.get(line);
    const old = before && parseDialogueArgs(before.args);
    const fresh = after && parseDialogueArgs(after.args);
    if (!before || !after || !fresh?.voice || !old || old.actor !== fresh.actor || old.text !== fresh.text ||
      (old.emotion ?? '') !== (fresh.emotion ?? '') || fresh.voice.lineId !== id || fresh.voice.requested !== requested)
      throw new Error(`Line ${line} cannot be rewritten without changing its dialogue.`);
    after.args = before.args;
  }
  if (JSON.stringify(next) !== JSON.stringify(original))
    throw new Error('This rewrite would change the surrounding script. Edit this line by hand.');
  return { source: rewritten, skipped, count: changed.size };
}
