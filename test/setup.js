import { vi } from 'vitest';

// Global mock for child_process to prevent spawning real processes in tests
vi.mock('child_process', () => ({
  default: {
    spawn: vi.fn(),
    exec: vi.fn(),
    fork: vi.fn(),
  },
  spawn: vi.fn(),
  exec: vi.fn(),
  fork: vi.fn(),
}));

// Global mock for ws to prevent real WebSocket connections in tests
vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
    clients: new Set(),
  })),
  WebSocket: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1, // OPEN
  })),
}));
