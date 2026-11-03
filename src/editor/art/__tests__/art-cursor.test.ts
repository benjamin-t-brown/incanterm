import { describe, expect, it } from 'vitest';
import {
  CURSOR_HOT,
  getArtCursorKind,
  getCursorIcon,
  getCursorLayout,
  type ArtCursorGesture,
  type ArtTool,
} from '../art-cursor.js';

function createState(patch: {
  tool?: ArtTool;
  pasteMode?: boolean;
  spaceHeld?: boolean;
  gesture?: ArtCursorGesture | null;
  sampling?: boolean;
  blocked?: boolean;
}) {
  return {
    tool: 'brush' as ArtTool,
    pasteMode: false,
    spaceHeld: false,
    gesture: null,
    sampling: false,
    blocked: false,
    ...patch,
  };
}

describe('art cursor', () => {
  it('follows the tool, including foreground and background brushes', () => {
    expect(getArtCursorKind(createState({ tool: 'fill' }))).toBe('fill');
    expect(getArtCursorKind(createState({ tool: 'fg-erase' }))).toBe('fg-erase');
    expect(getArtCursorKind(createState({ tool: 'fg' }))).toBe('fg-brush');
    expect(getArtCursorKind(createState({ tool: 'bg' }))).toBe('bg-brush');
    expect(getArtCursorKind(createState({ tool: 'select' }))).toBe('select');
    expect(getArtCursorKind(createState({ tool: 'move' }))).toBe('move');
    expect(getArtCursorKind(createState({ tool: 'path' }))).toBe('path');
    expect(getArtCursorKind(createState({ tool: 'fg-path' }))).toBe('fg-path');
  });

  it('uses pan for space or a pan drag, without stealing another drag', () => {
    expect(getArtCursorKind(createState({ spaceHeld: true }))).toBe('pan');
    expect(getArtCursorKind(createState({ gesture: 'pan' }))).toBe('pan');
    expect(getArtCursorKind(createState({ tool: 'select', spaceHeld: true, gesture: 'select' }))).toBe(
      'select',
    );
    expect(getArtCursorKind(createState({ spaceHeld: true, blocked: true }))).toBe('pan');
  });

  it('prefers sampling, then a locked layer, then paste', () => {
    expect(getArtCursorKind(createState({ gesture: 'pick' }))).toBe('pick');
    expect(getArtCursorKind(createState({ sampling: true, blocked: true }))).toBe('pick');
    expect(getArtCursorKind(createState({ pasteMode: true }))).toBe('paste');
    expect(getArtCursorKind(createState({ blocked: true, pasteMode: true }))).toBe('blocked');
  });

  it('shares one badge per tool, strikes erase, and keeps the badge clear of the crosshair', () => {
    expect(getCursorIcon('fg-brush')).toEqual(getCursorIcon('brush'));
    expect(getCursorIcon('bg-brush')).toEqual(getCursorIcon('brush'));
    expect(getCursorIcon('fg-fill')).toEqual(getCursorIcon('fill'));
    expect(getCursorIcon('bg-fill')).toEqual(getCursorIcon('fill'));
    expect(getCursorIcon('fill').d.startsWith('M274.639 24.324')).toBe(true);
    expect(getCursorIcon('select').d.startsWith('M138.563 16.063')).toBe(true);
    expect(getCursorIcon('path').d.startsWith('M429.548 30.836')).toBe(true);
    expect(getCursorIcon('fg-path')).toEqual(getCursorIcon('path'));
    expect(getCursorIcon('bg-path')).toEqual(getCursorIcon('path'));
    expect(getCursorIcon('select').struck).toBe(false);
    expect(getCursorIcon('fill').struck).toBe(false);
    expect(getCursorIcon('erase')).toEqual({ d: getCursorIcon('brush').d, struck: true });
    expect(getCursorIcon('fg-erase')).toEqual(getCursorIcon('erase'));
    expect(getCursorIcon('bg-erase')).toEqual(getCursorIcon('erase'));
    expect(getCursorIcon('brush').struck).toBe(false);

    const idle = getCursorLayout(false);
    const pressed = getCursorLayout(true);
    expect(pressed.reach).toBeLessThan(idle.reach);
    expect(pressed.iconX).toBe(idle.iconX);
    expect(pressed.iconY).toBe(idle.iconY);
    expect(idle.iconX).toBeGreaterThan(CURSOR_HOT.x);
    expect(idle.iconY + idle.icon).toBeLessThan(CURSOR_HOT.y);
  });
});
