import { AnimatedProp } from './animated-prop.js';
import type { Scene } from './scene.js';

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
