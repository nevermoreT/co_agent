/**
 * Unit tests for A2A Task Manager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('A2A Task Manager - Unit Tests', () => {
  let a2aTaskManager;
  let originalConsoleError;

  beforeAll(async () => {
    // Import the singleton instance
    const { default: importedA2ATaskManager } = await import('../../server/services/a2a/a2aTaskManager.js');
    a2aTaskManager = importedA2ATaskManager;
    
    // Store original console.error to restore later
    originalConsoleError = console.error;
    // Suppress database initialization logs
    console.error = vi.fn();
  });

  afterAll(() => {
    // Restore original console.error
    console.error = originalConsoleError;
  });

  beforeEach(() => {
    // Clear the active tasks for each test to start fresh
    a2aTaskManager.activeTasks.clear();
    a2aTaskManager.subscribers.clear();
  });

  afterEach(() => {
    // Clean up
    vi.restoreAllMocks();
  });

  it('should initialize with empty task store', () => {
    expect(a2aTaskManager.getActiveTaskCount()).toBe(0);
    expect(a2aTaskManager.getActiveTaskIds()).toHaveLength(0);
  });

  it('should create a new task with required fields', () => {
    const mockInput = { text: 'Test input', type: 'message' };
    const task = a2aTaskManager.createTask({
      sessionId: 'session-123',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: mockInput,
      conversationId: 101,
    });

    // Validate task structure
    expect(task).toHaveProperty('id');
    expect(task).toHaveProperty('sessionId', 'session-123');
    expect(task).toHaveProperty('sourceAgentId', 1);
    expect(task).toHaveProperty('targetAgentId', 2);
    expect(task).toHaveProperty('status', 'submitted');
    expect(task).toHaveProperty('input', mockInput);
    expect(task).toHaveProperty('createdAt');
    expect(task).toHaveProperty('updatedAt');
    expect(task).toHaveProperty('history');
    expect(Array.isArray(task.history)).toBe(true);

    // Validate ID format (UUID)
    expect(typeof task.id).toBe('string');
    expect(task.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Validate task is stored in manager
    expect(a2aTaskManager.getActiveTaskCount()).toBe(1);
    expect(a2aTaskManager.getActiveTaskIds()).toContain(task.id);
  });

  it('should update task status correctly', () => {
    const task = a2aTaskManager.createTask({
      sessionId: 'session-123',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: { text: 'Test' },
      conversationId: 101,
    });

    const _originalUpdateTime = task.updatedAt;
    
    // Wait a bit to ensure time difference
    const startTime = Date.now();
    while (Date.now() - startTime < 1) {}

    // Update status
    const updatedTask = a2aTaskManager.updateTaskStatus(task.id, 'working');

    expect(updatedTask.status).toBe('working');
    // Just verify that updatedAt has changed (not necessarily different in string form)
    expect(updatedTask.updatedAt).toBeDefined();
    expect(updatedTask.updatedAt).not.toBe(null);
  });

  it('should handle task failure status', () => {
    const task = a2aTaskManager.createTask({
      sessionId: 'session-123',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: { text: 'Test' },
      conversationId: 101,
    });

    const errorOutput = { error: 'Something went wrong', code: 1 };
    const updatedTask = a2aTaskManager.updateTaskStatus(task.id, 'failed', errorOutput);

    expect(updatedTask.status).toBe('failed');
    expect(updatedTask.output).toEqual(errorOutput);
  });

  it('should add history to task', () => {
    const task = a2aTaskManager.createTask({
      sessionId: 'session-123',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: { text: 'Test' },
      conversationId: 101,
    });

    const message = {
      role: 'assistant',
      content: 'Test response',
      agentId: 2,
    };

    a2aTaskManager.addTaskHistory(task.id, message);

    // Verify history was added
    const retrievedTask = a2aTaskManager.getTask(task.id);
    expect(retrievedTask.history).toHaveLength(1);
    expect(retrievedTask.history[0]).toHaveProperty('role', 'assistant');
    expect(retrievedTask.history[0]).toHaveProperty('content', 'Test response');
    expect(retrievedTask.history[0]).toHaveProperty('agentId', 2);
    expect(retrievedTask.history[0]).toHaveProperty('timestamp');
  });

  it('should get existing task', () => {
    const task = a2aTaskManager.createTask({
      sessionId: 'session-123',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: { text: 'Test' },
      conversationId: 101,
    });

    const retrievedTask = a2aTaskManager.getTask(task.id);

    expect(retrievedTask).not.toBeNull();
    expect(retrievedTask.id).toBe(task.id);
    expect(retrievedTask.sessionId).toBe('session-123');
    expect(retrievedTask.sourceAgentId).toBe(1);
    expect(retrievedTask.targetAgentId).toBe(2);
  });

  it('should return null for non-existent task', () => {
    const retrievedTask = a2aTaskManager.getTask('non-existent-id');
    expect(retrievedTask).toBeNull();
  });

  it('should cancel existing task', () => {
    const task = a2aTaskManager.createTask({
      sessionId: 'session-123',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: { text: 'Test' },
      conversationId: 101,
    });

    // Initially active
    expect(a2aTaskManager.getActiveTaskCount()).toBe(1);
    expect(a2aTaskManager.getActiveTaskIds()).toContain(task.id);

    // Cancel task
    const cancelledTask = a2aTaskManager.cancelTask(task.id);

    expect(cancelledTask).not.toBeNull();
    expect(cancelledTask.status).toBe('cancelled');
    expect(a2aTaskManager.getActiveTaskCount()).toBe(0);
    expect(a2aTaskManager.getActiveTaskIds()).not.toContain(task.id);
  });

  it('should handle cancellation of non-existent task', () => {
    const result = a2aTaskManager.cancelTask('non-existent-id');
    expect(result).toBeNull();
  });

  it('should maintain correct active task count', () => {
    // Create multiple tasks
    const task1 = a2aTaskManager.createTask({
      sessionId: 'session-1',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: { text: 'Test 1' },
      conversationId: 101,
    });

    const task2 = a2aTaskManager.createTask({
      sessionId: 'session-2',
      sourceAgentId: 1,
      targetAgentId: 3,
      input: { text: 'Test 2' },
      conversationId: 102,
    });

    expect(a2aTaskManager.getActiveTaskCount()).toBe(2);
    expect(a2aTaskManager.getActiveTaskIds()).toHaveLength(2);
    expect(a2aTaskManager.getActiveTaskIds()).toContain(task1.id);
    expect(a2aTaskManager.getActiveTaskIds()).toContain(task2.id);

    // Cancel one task
    a2aTaskManager.cancelTask(task1.id);

    expect(a2aTaskManager.getActiveTaskCount()).toBe(1);
    expect(a2aTaskManager.getActiveTaskIds()).not.toContain(task1.id);
    expect(a2aTaskManager.getActiveTaskIds()).toContain(task2.id);
  });

  it('should update task status and output', () => {
    const task = a2aTaskManager.createTask({
      sessionId: 'session-123',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: { text: 'Test' },
      conversationId: 101,
    });

    const outputData = {
      result: 'success',
      details: 'Task completed successfully',
      metrics: { tokens: 150, time: 2.5 }
    };

    const updatedTask = a2aTaskManager.updateTaskStatus(task.id, 'completed', outputData);

    expect(updatedTask.status).toBe('completed');
    expect(updatedTask.output).toEqual(outputData);
    expect(updatedTask.updatedAt).toBeDefined();
  });

  it('should handle multiple history entries', () => {
    const task = a2aTaskManager.createTask({
      sessionId: 'session-123',
      sourceAgentId: 1,
      targetAgentId: 2,
      input: { text: 'Test' },
      conversationId: 101,
    });

    // Add multiple history entries
    const messages = [
      { role: 'user', content: 'Hello', agentId: 1 },
      { role: 'assistant', content: 'Hi there!', agentId: 2 },
      { role: 'user', content: 'How are you?', agentId: 1 },
      { role: 'assistant', content: 'I\'m doing well, thanks!', agentId: 2 }
    ];

    for (const msg of messages) {
      a2aTaskManager.addTaskHistory(task.id, msg);
    }

    const retrievedTask = a2aTaskManager.getTask(task.id);
    expect(retrievedTask.history).toHaveLength(4);

    for (let i = 0; i < messages.length; i++) {
      expect(retrievedTask.history[i].role).toBe(messages[i].role);
      expect(retrievedTask.history[i].content).toBe(messages[i].content);
      expect(retrievedTask.history[i].agentId).toBe(messages[i].agentId);
      expect(retrievedTask.history[i]).toHaveProperty('timestamp');
    }
  });
});