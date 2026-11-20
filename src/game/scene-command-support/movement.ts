import type { CharacterDirection } from '../../editor/schema.js';
import type { Character } from '../character.js';
import { findCharacter, findPath, type Point } from '../character-movement.js';
import type { CommandContext } from '../rpgscript/command.js';
import type { GameScriptContext } from './context.js';

export function walkScriptedToDestination(
  name: string, destination: Point, skipWait: boolean,
  script: CommandContext, game: GameScriptContext,
): void {
  const character = findCharacter(game.scene, name, game.playerControl.playerWalkCh);
  if (character.x === destination.x && character.bottomY === destination.y) return;
  const maxAttempts = 4;
  const retryIntervalMs = 100;
  let attempts = 0;
  let retryAtMs = 0;
  const startAttempt = (): void => {
    attempts++;
    const path = findPath(game.scene, character, destination);
    const closest = path.at(-1);
    if (closest) game.playerControl.walkScripted(character, closest);
    retryAtMs = Date.now() + retryIntervalMs;
  };
  startAttempt();
  if (skipWait) return;
  script.waitUntil(() => {
    if (character.x === destination.x && character.bottomY === destination.y) return true;
    if (game.playerControl.wasWalkCancelled(character)) return true;
    if (game.playerControl.isWalkPausedForConversation(character, destination)) return false;
    if (character.isWalking()) return false;
    if (attempts >= maxAttempts) return true;
    if (Date.now() < retryAtMs) return false;
    startAttempt();
    return character.x === destination.x && character.bottomY === destination.y;
  });
}

export function setFacingToward(character: Character, x: number, y: number): void {
  const direction = getFacingToward(character.x, character.bottomY, x, y);
  if (!direction) return;
  character.facing = direction;
  character.animate(0);
}

export function getFacingToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): CharacterDirection | undefined {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (dx === 0 && dy === 0) return;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}
