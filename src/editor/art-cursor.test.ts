import { describe, expect, it } from 'vitest';
import {
  CURSOR_HOT,
  artCursorKind,
  cursorIcon,
  cursorLayout,
  type ArtCursorGesture,
  type ArtTool,
} from './art-cursor.js';

function state(patch: {
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
    expect(artCursorKind(state({ tool: 'fill' }))).toBe('fill');
    expect(artCursorKind(state({ tool: 'fg-erase' }))).toBe('fg-erase');
    expect(artCursorKind(state({ tool: 'fg' }))).toBe('fg-brush');
    expect(artCursorKind(state({ tool: 'bg' }))).toBe('bg-brush');
    expect(artCursorKind(state({ tool: 'select' }))).toBe('select');
  });

  it('uses pan for space or a pan drag, without stealing another drag', () => {
    expect(artCursorKind(state({ spaceHeld: true }))).toBe('pan');
    expect(artCursorKind(state({ gesture: 'pan' }))).toBe('pan');
    expect(artCursorKind(state({ tool: 'select', spaceHeld: true, gesture: 'select' }))).toBe(
      'select',
    );
    expect(artCursorKind(state({ spaceHeld: true, blocked: true }))).toBe('pan');
  });

  it('prefers sampling, then a locked layer, then paste', () => {
    expect(artCursorKind(state({ gesture: 'pick' }))).toBe('pick');
    expect(artCursorKind(state({ sampling: true, blocked: true }))).toBe('pick');
    expect(artCursorKind(state({ pasteMode: true }))).toBe('paste');
    expect(artCursorKind(state({ blocked: true, pasteMode: true }))).toBe('blocked');
  });

  it('shares one badge per tool, strikes erase, and keeps the badge clear of the crosshair', () => {
    expect(cursorIcon('fg-brush')).toEqual(cursorIcon('brush'));
    expect(cursorIcon('bg-brush')).toEqual(cursorIcon('brush'));
    expect(cursorIcon('fg-fill')).toEqual(cursorIcon('fill'));
    expect(cursorIcon('bg-fill')).toEqual(cursorIcon('fill'));
    expect(cursorIcon('fill').d.startsWith('M274.639 24.324')).toBe(true);
    expect(cursorIcon('select').d.startsWith('M138.563 16.063')).toBe(true);
    expect(cursorIcon('select').struck).toBe(false);
    expect(cursorIcon('fill').struck).toBe(false);
    expect(cursorIcon('erase')).toEqual({ d: cursorIcon('brush').d, struck: true });
    expect(cursorIcon('fg-erase')).toEqual(cursorIcon('erase'));
    expect(cursorIcon('bg-erase')).toEqual(cursorIcon('erase'));
    expect(cursorIcon('brush').struck).toBe(false);

    const idle = cursorLayout(false);
    const pressed = cursorLayout(true);
    expect(pressed.reach).toBeLessThan(idle.reach);
    expect(pressed.iconX).toBe(idle.iconX);
    expect(pressed.iconY).toBe(idle.iconY);
    expect(idle.iconX).toBeGreaterThan(CURSOR_HOT.x);
    expect(idle.iconY + idle.icon).toBeLessThan(CURSOR_HOT.y);
  });
});
