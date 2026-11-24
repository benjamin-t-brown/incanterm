import type { CommandArg } from '../rpgscript/parser.js';
import { getVoiceRevision, isVoiceLineId, type VoiceLine } from '../../voice/contracts.js';

export type DialogueVoice = Readonly<Pick<VoiceLine, 'lineId' | 'requested' | 'revision'>>;
type ParsedDialogue = {
  type: 'dialogue';
  actor: string;
  text: string;
  emotion?: string;
  voice?: DialogueVoice;
};

export function hasDialoguePlaceholder(text: string): boolean {
  return /\{[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*\}|\[[A-Za-z_][\w-]*\]/.test(text);
}

// Also used by the catalog and writer: the ID and opt-out flag are literal metadata,
// never interpolated script values. Existing text-only dialogue may still interpolate.
export function parseDialogueArgs(args: readonly CommandArg[]): ParsedDialogue | undefined {
  const [actor, text, emotion, lineId, mode] = args;
  if (args.length === 1 && typeof actor === 'object' && 'actorName' in actor)
    return {
      type: 'dialogue',
      actor: actor.actorName,
      text: actor.text,
      emotion: actor.portraitEmotion,
    };
  if (
    args.length < 2 ||
    args.length > 5 ||
    typeof actor !== 'string' ||
    typeof text !== 'string' ||
    (emotion !== undefined && typeof emotion !== 'string')
  )
    return;
  if (args.length < 4) return { type: 'dialogue', actor, text, emotion };
  if (!isVoiceLineId(lineId) || (args.length === 5 && mode !== 'no-voice')) return;
  if (mode !== 'no-voice' && (hasDialoguePlaceholder(actor) || hasDialoguePlaceholder(text)))
    return;
  return {
    type: 'dialogue',
    actor,
    text,
    emotion,
    voice: { lineId, requested: mode !== 'no-voice', revision: getVoiceRevision(actor, text) },
  };
}
