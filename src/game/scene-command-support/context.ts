import type { Character } from '../character.js';
import type { PlayerControl } from '../player-control.js';
import type { PropSlideControl } from '../prop-slide-control.js';
import type { Prop, Scene } from '../scene.js';

export type GameScriptContext = {
  scene: Scene;
  playerControl: PlayerControl;
  bark?: (target: Prop, text: string, ms: number) => () => boolean;
  clearBark?: (character: Character) => void;
  clearCharacterSubscript?: (ownerId: string) => void;
  resetConversationPortraits?: () => void;
  changeScene?: (sceneId: string, markerName: string | undefined, location: string) => Promise<void>;
  startScreenFade?: (target: 0 | 1, ms: number) => () => boolean;
  propSlides?: PropSlideControl;
  resetPropSlides?: (safeMarkerName: string, background: boolean) => boolean;
  beginPropSlideInteraction?: () => void;
  revealPropPushChoices?: () => void;
};

export type Choice = Readonly<{ text: string; target: string }>;
