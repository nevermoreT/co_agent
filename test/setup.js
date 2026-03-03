import { vi } from 'vitest';

// Global mock for child_process to prevent spawning real processes in tests
vi.mock('child_process', () => ({
  spawn: vi.fn(),
  exec: vi.fn(),
  fork: vi.fn(),
}));
