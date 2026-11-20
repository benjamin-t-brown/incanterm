import type { Character } from '../character.js';
import type { PlayerControl } from '../player-control.js';
import type { PropSlideControl } from '../prop-slide-control.js';
import type { Scene } from '../scene.js';

export type GameScriptContext = {
  scene: Scene;
  playerControl: PlayerControl;
  bark?: (character: Character, text: string, ms: number) => () => boolean;
  clearBark?: (character: Character) => void;
  clearCharacterSubscript?: (ownerId: string) => void;
  resetConversationPortraits?: () => void;
  changeScene?: (sceneId: string, markerName: string | undefined, location: string) => Promise<void>;
  propSlides?: PropSlideControl;
  resetPropSlides?: (safeMarkerName: string, background: boolean) => boolean;
  beginPropSlideInteraction?: () => void;
  revealPropPushChoices?: () => void;
};

export type Choice = Readonly<{ text: string; target: string }>;
