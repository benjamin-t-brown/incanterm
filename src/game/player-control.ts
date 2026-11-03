import { Character, type CharacterActivity } from './character.js';
import { findCharacter, findPath, type Point } from './character-movement.js';
import type { Scene } from './scene.js';

export class PlayerControl {
  playerWalkCh: Character | undefined;
  private pendingTalk?: { target: Character; destination: Point; run: (script: string, target: Character) => void };
  private conversation?: { target: Character; activity: CharacterActivity };
  constructor(readonly scene: Scene) {}

  setPlayerWalkCh(idOrInstanceName: string): void {
    const character = findCharacter(this.scene, idOrInstanceName);
    this.stop();
    this.playerWalkCh = character;
  }

  stop(): void {
    this.pendingTalk = undefined;
    this.playerWalkCh?.stopWalking();
  }

  cancelTalk(): void {
    if (this.pendingTalk) this.stop();
  }

  update(): void {
    const pending = this.pendingTalk;
    const player = this.playerWalkCh;
    if (!pending || !player || player.isWalking()) return;
    this.pendingTalk = undefined;
    if (pending.target.talkScript && player.x === pending.destination.x && player.bottomY === pending.destination.y &&
      this.isAdjacent(player, pending.target)) {
      pending.run(pending.target.talkScript, pending.target);
    }
  }

  startConversation(target: Character): void {
    this.endConversation(false);
    this.conversation = { target, activity: target.getActivity() };
    target.stopWalking();
    const player = this.playerWalkCh;
    if (!player || player === target) return;
    const dx = (player.x - player.sprite.originX) * 2 + player.sprite.width - 1 -
      ((target.x - target.sprite.originX) * 2 + target.sprite.width - 1);
    const dy = player.bottomY - target.bottomY;
    if (Math.abs(dx) >= Math.abs(dy * 2) && dx !== 0) {
      target.facing = dx > 0 ? 'right' : 'left';
      player.facing = dx > 0 ? 'left' : 'right';
    } else if (dy !== 0) {
      target.facing = dy > 0 ? 'down' : 'up';
      player.facing = dy > 0 ? 'up' : 'down';
    }
  }

  endConversation(restore: boolean): void {
    const conversation = this.conversation;
    this.conversation = undefined;
    if (restore && conversation) conversation.target.restoreActivity(conversation.activity, this.scene);
  }

  private isAdjacent(player: Character, target: Character): boolean {
    const left = target.x - target.sprite.originX;
    const right = left + target.sprite.width - 1;
    return Math.max(left - player.x, 0, player.x - right) <= 1 &&
      Math.abs(player.bottomY - target.bottomY) <= 1 &&
      !(player.x >= left && player.x <= right && player.bottomY === target.bottomY);
  }

  private getTalkDestination(player: Character, target: Character): { point: Point; length: number } | undefined {
    const left = target.x - target.sprite.originX;
    const right = left + target.sprite.width - 1;
    let best: { point: Point; length: number } | undefined;
    for (let y = target.bottomY - 1; y <= target.bottomY + 1; y++) {
      for (let x = left - 1; x <= right + 1; x++) {
        const point = { x, y };
        if (x >= left && x <= right && y === target.bottomY) continue;
        if (x < 0 || y < 0 || x >= this.scene.width || y >= this.scene.height) continue;
        const path = findPath(this.scene, player, point);
        const end = path.at(-1) ?? { x: player.x, y: player.bottomY };
        if (end.x !== x || end.y !== y) continue;
        if (!best || path.length < best.length) best = { point, length: path.length };
      }
    }
    return best;
  }

  click(x: number, y: number, activate: (name: string, instanceId: string) => boolean,
    runTalk?: (script: string, target: Character) => void): void {
    if (x < 0 || y < 0 || x >= this.scene.width || y >= this.scene.height) return;
    this.pendingTalk = undefined;
    for (const trigger of this.scene.actionTriggers) {
      if (
        x >= trigger.x &&
        y >= trigger.y &&
        x < trigger.x + trigger.width &&
        y < trigger.y + trigger.height &&
        activate(trigger.trigger, trigger.id)
      ) {
        this.stop();
        return;
      }
    }
    const character = this.playerWalkCh;
    if (!character) return;
    const target = [...this.scene.entities].reverse().find((entity): entity is Character =>
      entity instanceof Character && entity !== character && !!entity.talkScript &&
      x >= entity.x - entity.sprite.originX &&
      x < entity.x - entity.sprite.originX + entity.sprite.width &&
      y >= entity.y - entity.sprite.originY &&
      y < entity.y - entity.sprite.originY + entity.sprite.height);
    if (target && runTalk) {
      const destination = this.getTalkDestination(character, target);
      if (!destination) return;
      this.stop();
      this.pendingTalk = { target, destination: destination.point, run: runTalk };
      if (destination.length) character.walkTo(this.scene, destination.point);
      this.update();
      return;
    }
    // Path coordinates use the sprite origin column. Clicks target its bottom center.
    // For an even width, choose the right-hand center cell on the integer grid.
    const centerOffset = Math.floor(character.sprite.width / 2) - character.sprite.originX;
    const anchorX = Math.max(0, Math.min(this.scene.width - 1, x - centerOffset));
    character.walkTo(this.scene, { x: anchorX, y });
  }
}
