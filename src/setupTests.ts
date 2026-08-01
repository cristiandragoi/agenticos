import '@testing-library/jest-dom';
class MockEventSource {
  onmessage: any = null;
  onerror: any = null;
  close() {}
}
(globalThis as any).EventSource = MockEventSource;