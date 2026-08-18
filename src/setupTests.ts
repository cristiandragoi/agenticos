import '@testing-library/jest-dom';
import { configure } from '@testing-library/dom';

// Load-sensitive jsdom suite: waitFor/findBy default to a 1000ms wall-clock
// window, which races under parallel workers on a busy machine (observed
// cross-file flakiness — different tests fail per run). Raise the bounded
// default so async streams/timers complete deterministically; assertions
// still verify real conditions (this is a bound, not a retry mask).
configure({ asyncUtilTimeout: 5000 });

/** EventSource mock with the full listener API used by useGatewayStream. */
class MockEventSource {
  static instances: MockEventSource[] = [];
  static CLOSED = 2;
  url: string;
  readyState = 0;
  onmessage: any = null;
  onerror: any = null;
  listeners: Record<string, any> = {};
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: any) { this.listeners[type] = cb; }
  removeEventListener(type: string) { delete this.listeners[type]; }
  close() { this.readyState = 2; }
}
(globalThis as any).EventSource = MockEventSource;