// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = jest.fn(() => 'blob:mock');
}
if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = jest.fn();
}

if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- dynamic polyfill for jsdom
  const util = require('util');
  globalThis.TextEncoder = util.TextEncoder;
  globalThis.TextDecoder = util.TextDecoder;
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}

// jsdom performs no layout, so elements always report zero size. Libraries
// that measure their container (e.g. @tanstack/react-virtual, used by
// VirtualizedList) see a zero-height viewport and never render any rows.
// Give elements a plausible size so virtualized lists render in tests.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  value: 600,
});
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  value: 600,
});

