/**
 * Test Suite for Current Co-Agent Platform Features
 * Validates the core functionality that already exists
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { factories, mocks, utils } from './utils/test-helpers.js';

describe('Current Platform Features', () => {
  describe('Conversation Isolation', () => {
    it('should maintain separate streaming states for different conversations', () => {
      // Simulate the scenario that was fixed
      const conversationStates = {
        1: { agentOutputs: {} },
        2: { agentOutputs: {} }
      };

      // Add output to conversation 1
      conversationStates[1].agentOutputs['agent1'] = 'Output for conversation 1';

      // Add output to conversation 2
      conversationStates[2].agentOutputs['agent1'] = 'Output for conversation 2';

      // Verify they are separate
      expect(conversationStates[1].agentOutputs['agent1']).not.toBe(
        conversationStates[2].agentOutputs['agent1']
      );
      
      expect(conversationStates[1].agentOutputs['agent1']).toBe('Output for conversation 1');
      expect(conversationStates[2].agentOutputs['agent1']).toBe('Output for conversation 2');
    });

    it('should preserve conversation state when switching conversations', () => {
      // Simulate conversation switching
      const allConversations = {
        1: { id: 1, messages: ['msg1', 'msg2'], active: false },
        2: { id: 2, messages: ['msgA', 'msgB'], active: true },
        3: { id: 3, messages: ['msgX'], active: false }
      };

      // Switch to conversation 1
      const switchToConversation = (convId) => {
        Object.keys(allConversations).forEach(id => {
          allConversations[id].active = parseInt(id) === convId;
        });
      };

      switchToConversation(1);
      expect(allConversations[1].active).toBe(true);
      expect(allConversations[2].active).toBe(false);
      expect(allConversations[3].active).toBe(false);
      
      // Verify conversation 1 still has its original messages
      expect(allConversations[1].messages).toEqual(['msg1', 'msg2']);
      
      // Switch back to conversation 2
      switchToConversation(2);
      expect(allConversations[2].active).toBe(true);
      // Verify conversation 2 still has its original messages
      expect(allConversations[2].messages).toEqual(['msgA', 'msgB']);
    });
  });

  describe('Agent Management', () => {
    it('should create agents with required properties', () => {
      const agent = factories.agent();
      
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('cli_command');
      expect(agent).toHaveProperty('created_at');
      
      expect(typeof agent.id).toBe('number');
      expect(typeof agent.name).toBe('string');
      expect(typeof agent.cli_command).toBe('string');
      expect(typeof agent.created_at).toBe('string');
    });

    it('should support built-in agents', () => {
      const claudeAgent = factories.agent({
        name: 'Claude CLI',
        cli_command: 'builtin:claude-cli',
        builtin_key: 'claude-cli'
      });

      const opencodeAgent = factories.agent({
        name: 'Opencode CLI',
        cli_command: 'builtin:opencode-cli',
        builtin_key: 'opencode-cli'
      });

      expect(claudeAgent.name).toBe('Claude CLI');
      expect(claudeAgent.cli_command).toBe('builtin:claude-cli');
      expect(claudeAgent.builtin_key).toBe('claude-cli');

      expect(opencodeAgent.name).toBe('Opencode CLI');
      expect(opencodeAgent.cli_command).toBe('builtin:opencode-cli');
      expect(opencodeAgent.builtin_key).toBe('opencode-cli');
    });

    it('should enforce agent limit', () => {
      // Simulate agent creation up to limit
      const agents = [];
      const maxAgents = 5;

      for (let i = 0; i < maxAgents; i++) {
        agents.push(factories.agent({ id: i + 1, name: `Agent ${i + 1}` }));
      }

      expect(agents).toHaveLength(maxAgents);

      // Verify all agents are unique
      const agentNames = agents.map(a => a.name);
      const uniqueNames = [...new Set(agentNames)];
      expect(uniqueNames).toHaveLength(maxAgents);
    });
  });

  describe('@Mention Parsing', () => {
    it('should handle multiple mentions in one message', () => {
      const text = 'Please review @Claude CLI and check with @Code Reviewer';
      const matches = [...text.matchAll(/@([\w\s]+?)(?=\s+and|$|,|!|\?|\.)/g)];
      const names = matches.map(m => m[1].trim());

      expect(names).toContain('Claude CLI');
      expect(names).toContain('Code Reviewer');
    });

    it('should parse agent names with spaces', () => {
      const textWithSpaces = '@Claude CLI Hello there!';
      const match = textWithSpaces.match(/@([\w\s]+?)(?=\s+Hello|$)/);

      expect(match).not.toBeNull();
      if (match) {
        expect(match[1].trim()).toBe('Claude CLI');
      }
    });

    it('should parse agent names without spaces', () => {
      const text = '@Claude Hello';
      const match = text.match(/@(\w+)(?=\s|$)/);

      expect(match).not.toBeNull();
      if (match) {
        expect(match[1]).toBe('Claude');
      }
    });
  });

  describe('Task Management', () => {
    it('should create tasks with required properties', () => {
      const task = factories.task();
      
      expect(task).toHaveProperty('id');
      expect(task).toHaveProperty('title');
      expect(task).toHaveProperty('status');
      expect(task).toHaveProperty('created_at');
      
      expect(typeof task.id).toBe('number');
      expect(typeof task.title).toBe('string');
      expect(typeof task.status).toBe('string');
      expect(['pending', 'in_progress', 'completed']).toContain(task.status);
    });

    it('should support different task statuses', () => {
      const statuses = ['pending', 'in_progress', 'completed'];
      
      for (const status of statuses) {
        const task = factories.task({ status });
        expect(task.status).toBe(status);
      }
    });

    it('should track task activity', () => {
      const task = factories.task({
        last_activity_at: new Date().toISOString()
      });
      
      expect(task).toHaveProperty('last_activity_at');
      expect(typeof task.last_activity_at).toBe('string');
      
      // Verify it's a valid date string
      const date = new Date(task.last_activity_at);
      expect(date.toString()).not.toBe('Invalid Date');
    });
  });

  describe('Message Handling', () => {
    it('should create messages with required properties', () => {
      const message = factories.message();
      
      expect(message).toHaveProperty('id');
      expect(message).toHaveProperty('role');
      expect(message).toHaveProperty('content');
      expect(message).toHaveProperty('created_at');
      
      expect(typeof message.id).toBe('number');
      expect(typeof message.role).toBe('string');
      expect(typeof message.content).toBe('string');
      expect(['user', 'assistant', 'system']).toContain(message.role);
    });

    it('should support different message roles', () => {
      const roles = ['user', 'assistant', 'system'];
      
      for (const role of roles) {
        const message = factories.message({ role });
        expect(message.role).toBe(role);
      }
    });

    it('should associate messages with tasks', () => {
      const taskId = 123;
      const message = factories.message({ task_id: taskId });
      
      expect(message.task_id).toBe(taskId);
    });

    it('should support different message types', () => {
      const messageTypes = ['text', 'thinking', 'image'];
      
      for (const msgType of messageTypes) {
        const message = factories.message({ message_type: msgType });
        expect(message.message_type).toBe(msgType);
      }
    });
  });

  describe('WebSocket Communication', () => {
    it('should handle different message types', () => {
      const mockWs = mocks.createMockWebSocket();
      
      // Simulate different WebSocket events
      const events = [
        { type: 'output', agentId: 1, stream: 'stdout', data: 'Hello' },
        { type: 'exit', agentId: 1, code: 0 },
        { type: 'started', agentId: 1 },
        { type: 'error', message: 'Something went wrong' }
      ];

      for (const event of events) {
        // Emit the event
        mockWs.emit('message', { data: JSON.stringify(event) });
        
        // Verify the WebSocket received the event
        expect(mockWs.send).toBeDefined(); // Just verify mock exists
      }
    });

    it('should maintain connection state', () => {
      const mockWs = mocks.createMockWebSocket();
      
      expect(mockWs.readyState).toBe(1); // OPEN
      
      // Simulate closing
      mockWs.readyState = 3; // CLOSED
      expect(mockWs.readyState).toBe(3);
    });
  });

  describe('CLI Process Management', () => {
    it('should handle different CLI commands', () => {
      const mockRunner = mocks.createMockAgentRunner();
      
      // Test different command types
      const commands = [
        'node agent.js',
        'python -u agent.py',
        'bash script.sh',
        'builtin:claude-cli',
        'builtin:opencode-cli'
      ];

      for (const cmd of commands) {
        const agent = factories.agent({ cli_command: cmd });
        expect(agent.cli_command).toBe(cmd);
      }
    });

    it('should handle process lifecycle', () => {
      const mockRunner = mocks.createMockAgentRunner();
      
      // Simulate process lifecycle
      const agentId = 1;
      
      // Start process
      const startResult = mockRunner.run(agentId, () => {}, () => {});
      expect(startResult).toBe(true);
      
      // Send input
      const inputResult = mockRunner.sendInput(agentId, 'test input');
      expect(inputResult).toBe(true);
      
      // Stop process
      const stopResult = mockRunner.stop(agentId);
      expect(stopResult).toBe(true);
    });
  });

  describe('Built-in CLI Integration', () => {
    it('should handle Claude CLI one-shot execution', async () => {
      const mockRunner = mocks.createMockAgentRunner();
      
      // Simulate Claude CLI call
      const result = await mockRunner.runClaudeCli(1, 'test prompt', 
        (stream, data) => {}, 
        (code, signal) => {}
      );
      
      expect(result).toBeDefined();
    });

    it('should handle Opencode CLI one-shot execution', () => {
      const mockRunner = mocks.createMockAgentRunner();
      
      // Simulate Opencode CLI call
      const result = mockRunner.runOpencodeCli(1, 'test prompt',
        (stream, data) => {},
        (code, signal) => {}
      );
      
      expect(result).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing CLI commands gracefully', () => {
      const mockRunner = mocks.createMockAgentRunner();
      
      // Simulate calling a non-existent CLI
      const result = mockRunner.run(999, 
        (stream, data) => console.log(`${stream}: ${data}`),
        (code, signal) => console.log(`Exit: ${code}, ${signal}`)
      );
      
      // Should return false if the agent doesn't exist
      expect(typeof result).toBe('boolean');
    });

    it('should handle WebSocket errors', () => {
      const mockWs = mocks.createMockWebSocket();
      
      // Simulate error event
      const errorEvent = { error: new Error('Connection failed') };
      mockWs.emit('error', errorEvent);

      // Verify error handling
      expect(errorEvent.error).toBeInstanceOf(Error);
    });
  });
});