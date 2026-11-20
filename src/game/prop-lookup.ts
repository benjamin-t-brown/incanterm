import { AnimatedProp } from './animated-prop.js';
import { Character } from './character.js';
import { WorldItem } from './items.js';
import { Background, Prop, type Scene } from './scene.js';

export function findProp(scene: Scene, reference: string): Prop {
  const normalized = reference.toLowerCase();
  const props = scene.entities.filter((entity): entity is Prop =>
    entity instanceof Prop && !(entity instanceof Background || entity instanceof Character || entity instanceof WorldItem));
  const byId = props.find((prop) => prop.id.toLowerCase() === normalized);
  if (byId) return byId;
  const byName = props.filter((prop) => prop.instanceName?.toLowerCase() === normalized);
  if (byName.length > 1)
    throw new Error(`Scene ${scene.id} prop ${reference} is ambiguous; use an instance ID`);
  if (byName[0]) return byName[0];
  throw new Error(`Scene ${scene.id} has no prop ${reference}`);
}

/** Find every animated prop whose instance name (or id) matches `reference` (case-insensitive). */
export function findAnimatedProps(scene: Scene, reference: string): AnimatedProp[] {
  const normalized = reference.toLowerCase();
  const props = scene.entities.filter((entity): entity is AnimatedProp => entity instanceof AnimatedProp);
  const byName = props.filter((prop) => prop.instanceName?.toLowerCase() === normalized);
  if (byName.length) return byName;
  const byId = props.filter((prop) => prop.id.toLowerCase() === normalized);
  if (byId.length) return byId;
  throw new Error(`Scene ${scene.id} has no prop ${reference}`);
}
