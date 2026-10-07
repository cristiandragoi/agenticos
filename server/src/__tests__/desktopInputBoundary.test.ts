import { describe, it, expect } from 'vitest';
import { prepareDesktopInput } from '../domains/controlPlane/computerUse/DesktopInput.js';

const bounds = { left: -500, top: 10, width: 400, height: 300 };
describe('desktop input validation (no physical desktop interaction)', () => {
  it('refuses missing inputs and unsupported actions instead of claiming success', () => {
    for (const type of ['CLICK', 'DRAG', 'TYPE', 'HOTKEY', 'SCROLL', 'UNKNOWN']) {
      expect(() => prepareDesktopInput({ type }, bounds, 123)).toThrow();
    }
  });
  it('keeps executable-looking text as data', () => {
    const text = '\"; $(Write-Output injection) #';
    expect(prepareDesktopInput({ type: 'TYPE', text }, bounds, 123)).toEqual({ type: 'TYPE', hwnd: 123, text });
  });
  it('supports actual scroll, hotkey chords and bounded drag inputs', () => {
    expect(prepareDesktopInput({ type: 'SCROLL', scrollDelta: -3 }, bounds, 123)).toMatchObject({ delta: -3 });
    expect(prepareDesktopInput({ type: 'HOTKEY', key: 'Ctrl+Shift+A' }, bounds, 123)).toMatchObject({ keys: ['ctrl', 'shift', 'a'] });
    expect(prepareDesktopInput({ type: 'DRAG', coordinates: { x: 0, y: 0 }, destination: { x: 399, y: 299 } }, bounds, 123))
      .toMatchObject({ point: { x: -500, y: 10 }, destination: { x: -101, y: 309 } });
  });
  it('refuses out-of-window input, injected key names and unsupported text', () => {
    expect(() => prepareDesktopInput({ type: 'CLICK', coordinates: { x: 400, y: 0 } }, bounds, 123)).toThrow();
    expect(() => prepareDesktopInput({ type: 'CLICK', coordinates: { x: NaN, y: 0 } }, bounds, 123)).toThrow();
    expect(() => prepareDesktopInput({ type: 'HOTKEY', key: "a'); print('oops" }, bounds, 123)).toThrow();
    expect(() => prepareDesktopInput({ type: 'TYPE', text: '中文' }, bounds, 123)).toThrow();
  });
});
