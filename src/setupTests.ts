import '@testing-library/jest-dom';

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