import { isVoiceLineId } from '../../voice/model.js';

/** Only recognize the suffix outside the quoted dialogue, never words inside it. */
export function parseVoiceAnnotation(text: string) {
  const trimmed = text.trimEnd();
  if (trimmed.endsWith(trimmed[0]) && (trimmed[0] === '"' || trimmed[0] === "'")) return;
  const match = /^(?<spoken>"[^\n]*"|'[^\n]*')[ \t]*\/\/[ \t]*(?<mode>no-voice|voice)\b(?<tail>.*)$/.exec(trimmed);
  if (!match?.groups) return;
  const id = match.groups.tail.trim();
  if (id && !isVoiceLineId(id)) throw new Error('Expected a single voice line ID after the voice marker');
  return { spoken: match.groups.spoken, requested: match.groups.mode === 'voice', id };
}
