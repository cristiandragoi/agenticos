import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
interface Point { x: number; y: number }
interface Bounds { left: number; top: number; width: number; height: number }
export interface DesktopInput {
  type: string; coordinates?: Point; destination?: Point;
  text?: string; key?: string; scrollDelta?: number;
}

// Data is passed as one JSON argument, never interpolated into shell or Python code.
export function prepareDesktopInput(action: DesktopInput, bounds: Bounds | undefined, hwnd: number) {
  if (!Number.isSafeInteger(hwnd) || hwnd <= 0) throw new Error('Invalid target window');
  const point = (p?: Point) => {
    if (!bounds || ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
      || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)
      || p.x < 0 || p.y < 0 || p.x >= bounds.width || p.y >= bounds.height)
      throw new Error('Coordinates must be inside the observed target window');
    return { x: Math.round(bounds.left + p.x), y: Math.round(bounds.top + p.y) };
  };
  switch (action.type) {
    case 'CLICK': return { type: action.type, hwnd, point: point(action.coordinates) };
    case 'DRAG': return { type: action.type, hwnd, point: point(action.coordinates), destination: point(action.destination) };
    case 'TYPE':
      // pyautogui cannot reliably type arbitrary Unicode. Refuse rather than silently lose text.
      if (!action.text || action.text.length > 2000 || /[^\x20-\x7e]/.test(action.text))
        throw new Error('This input method requires 1–2000 printable ASCII characters; use structured text input otherwise');
      return { type: action.type, hwnd, text: action.text };
    case 'HOTKEY': {
      const keys = (action.key || '').toLowerCase().split('+').map(k => k.trim());
      if (!keys.length || keys.length > 5 || keys.some(k => !/^(?:[a-z0-9]|f(?:[1-9]|1[0-2])|ctrl|alt|shift|win|enter|tab|esc|escape|space|backspace|delete|home|end|left|right|up|down|pageup|pagedown)$/.test(k)))
        throw new Error('Invalid hotkey');
      return { type: action.type, hwnd, keys };
    }
    case 'SCROLL':
      if (!Number.isInteger(action.scrollDelta) || !action.scrollDelta || Math.abs(action.scrollDelta) > 100)
        throw new Error('Scroll delta must be a nonzero integer within 100 ticks');
      return { type: action.type, hwnd, delta: action.scrollDelta,
        point: point(action.coordinates || (bounds ? { x: Math.floor(bounds.width / 2), y: Math.floor(bounds.height / 2) } : undefined)) };
    default: throw new Error(`Unsupported desktop input: ${action.type}`);
  }
}

const SCRIPT = `import sys,json,ctypes
import pyautogui as p
d=json.loads(sys.argv[1])
u=ctypes.windll.user32
u.GetForegroundWindow.restype=ctypes.c_void_p
if u.GetForegroundWindow()!=d['hwnd']: raise RuntimeError('Target lost foreground before input')
t=d['type']
if t=='CLICK': p.click(d['point']['x'],d['point']['y'])
elif t=='DRAG':
 p.moveTo(d['point']['x'],d['point']['y'])
 p.dragTo(d['destination']['x'],d['destination']['y'],duration=0.4)
elif t=='TYPE': p.write(d['text'],interval=0)
elif t=='HOTKEY': p.hotkey(*d['keys'])
elif t=='SCROLL': p.scroll(d['delta'],x=d['point']['x'],y=d['point']['y'])
else: raise RuntimeError('Unsupported input')
print('INPUT_DISPATCHED')
`;

export async function dispatchDesktopInput(payload: ReturnType<typeof prepareDesktopInput>) {
  const result = await run('python', ['-c', SCRIPT, JSON.stringify(payload)], { timeout: 5000, windowsHide: true });
  if (result.stdout.trim() !== 'INPUT_DISPATCHED') throw new Error('Desktop input did not acknowledge dispatch');
  // Dispatch is not independent verification of the requested application outcome.
}
