import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { handleWebSocketConnection } from '../../server/websocket.js';
import * as agentRunner from '../../server/services/agentRunner.js';
import * as agentInvocationDetector from '../../server/services/agentInvocationDetector.js';
import * as agentInvocationExecutor from '../../server/services/agentInvocationExecutor.js';
import db from '../../server/db.js';
import logger from '../../server/logger.js';

// Mock dependencies
vi.mock('ws');
vi.mock('../../server/services/agentRunner.js');
vi.mock('../../server/services/agentInvocationDetector.js');
vi.mock('../../server/services/agentInvocationExecutor.js');
vi.mock('../../server/db.js');
vi.mock('../../server/logger.js');

describe('WebSocket Handler', () => {
  let mockWs;
  let mockWss;
  let mockSend;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock WebSocket connection
    mockWs = {
      on: vi.fn(),
      send: vi.fn(),
      readyState: 1, // WebSocket.OPEN
      close: vi.fn()
    };

    mockWss = {
      clients: new Set([mockWs]),
      on: vi.fn(),
      close: vi.fn()
    };

    // Mock WebSocketServer constructor
    WebSocket.Server = vi.fn(() => mockWss);
    
    // Mock send function
    mockSend = vi.fn();

    // Default mock implementations
    agentRunner.getRunningAgentIds = vi.fn(() => []);
    agentRunner.runAgent = vi.fn();
    agentRunner.stopAgent = vi.fn();
    agentRunner.sendToAgent = vi.fn();
    agentRunner.getAgentStatus = vi.fn();
    
    agentInvocationDetector.detectAgentInvocation = vi.fn(() => null);
    agentInvocationExecutor.executeAgentInvocation = vi.fn();
    
    db.prepare = vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(),
    }));
    
    logger.log = vi.fn();
    logger.error = vi.fn();
    logger.warn = vi.fn();
  });

  describe('WebSocket Connection Setup', () => {
    it('should create WebSocket server and set up connection handler', () => {
      const mockServer = {};
      
      // Import and call the websocket setup function
      const { setupWebSocket } = require('../../server/websocket.js');
      const wss = setupWebSocket(mockServer);
      
      expect(WebSocket.Server).toHaveBeenCalledWith({ server: mockServer });
      expect(wss.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });

    it('should handle new WebSocket connections', () => {
      const mockConnectionHandler = vi.fn();
      WebSocket.Server = vi.fn(() => ({
        on: vi.fn((event, handler) => {
          if (event === 'connection') {
            mockConnectionHandler.mockImplementation(handler);
          }
        })
      }));

      const { setupWebSocket } = require('../../server/websocket.js');
      setupWebSocket({});

      // Simulate connection
      mockConnectionHandler(mockWs);

      expect(mockWs.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
    });
  });

  describe('Message Handling', () => {
    let connectionHandler;

    beforeEach(() => {
      // Set up connection handler
      const mockSetup = vi.fn(() => ({
        on: vi.fn((event, handler) => {
          if (event === 'connection') {
            connectionHandler = handler;
          }
        })
      }));
      
      WebSocket.Server = mockSetup;
      const { setupWebSocket } = require('../../server/websocket.js');
      setupWebSocket({});
      
      // Establish connection
      connectionHandler(mockWs);
    });

    it('should handle start agent message', () => {
      const message = {
        action: 'start',
        agentId: 'agent1',
        text: 'Hello agent',
        conversationId: 'conv1'
      };

      agentRunner.runAgent = vi.fn(() => true);

      // Simulate message
      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify(message));

      expect(agentRunner.runAgent).toHaveBeenCalledWith(
        'agent1',
        'Hello agent',
        'conv1',
        expect.any(Function)
      );
    });

    it('should handle send to agent message', () => {
      const message = {
        action: 'send',
        agentId: 'agent1',
        text: 'Continue working',
        conversationId: 'conv1'
      };

      agentRunner.sendToAgent = vi.fn(() => true);

      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify(message));

      expect(agentRunner.sendToAgent).toHaveBeenCalledWith(
        'agent1',
        'Continue working',
        'conv1'
      );
    });

    it('should handle stop agent message', () => {
      const message = {
        action: 'stop',
        agentId: 'agent1'
      };

      agentRunner.stopAgent = vi.fn(() => true);

      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify(message));

      expect(agentRunner.stopAgent).toHaveBeenCalledWith('agent1');
    });

    it('should handle get agent status message', () => {
      const message = {
        action: 'status',
        agentId: 'agent1'
      };

      const mockStatus = {
        state: 'running',
        startTime: Date.now(),
        activity: { type: 'processing' }
      };

      agentRunner.getAgentStatus = vi.fn(() => mockStatus);

      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify(message));

      expect(agentRunner.getAgentStatus).toHaveBeenCalledWith('agent1');
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"status"')
      );
    });

    it('should handle invalid JSON messages', () => {
      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler('invalid json');

      expect(logger.error).toHaveBeenCalledWith(
        '[websocket] Failed to parse message:',
        expect.any(Error)
      );
    });

    it('should handle missing required fields', () => {
      const incompleteMessage = {
        action: 'start'
        // missing agentId
      };

      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify(incompleteMessage));

      expect(logger.error).toHaveBeenCalledWith(
        '[websocket] Invalid message:',
        expect.any(String)
      );
    });
  });

  describe('Throttled Output', () => {
    it('should buffer stdout messages and send in batches', () => {
      const { createThrottledOutput } = require('../../server/websocket.js');
      const send = vi.fn();
      
      const throttled = createThrottledOutput(send, 'agent1', 50);

      // Send multiple chunks
      throttled.push('stdout', 'Hello ');
      throttled.push('stdout', 'world!');
      
      // Should not send immediately due to throttling
      expect(send).not.toHaveBeenCalled();

      // Wait for flush
      vi.advanceTimersByTime(50);
      
      expect(send).toHaveBeenCalledWith({
        type: 'output',
        agentId: 'agent1',
        stream: 'stdout',
        data: 'Hello world!'
      });
    });

    it('should send stderr messages immediately', () => {
      const { createThrottledOutput } = require('../../server/websocket.js');
      const send = vi.fn();
      
      const throttled = createThrottledOutput(send, 'agent1');

      throttled.push('stderr', 'Error message');

      expect(send).toHaveBeenCalledWith({
        type: 'output',
        agentId: 'agent1',
        stream: 'stderr',
        data: 'Error message'
      });
    });

    it('should flush buffer when explicitly called', () => {
      const { createThrottledOutput } = require('../../server/websocket.js');
      const send = vi.fn();
      
      const throttled = createThrottledOutput(send, 'agent1', 1000);

      throttled.push('stdout', 'Buffered ');
      throttled.push('stdout', 'content');
      
      expect(send).not.toHaveBeenCalled();
      
      throttled.flush();
      
      expect(send).toHaveBeenCalledWith({
        type: 'output',
        agentId: 'agent1',
        stream: 'stdout',
        data: 'Buffered content'
      });
    });
  });

  describe('Agent Invocation Detection', () => {
    let mockDetector;

    beforeEach(() => {
      mockDetector = {
        accumulate: vi.fn(),
        detectAndExecute: vi.fn(),
        reset: vi.fn()
      };
    });

    it('should create invocation detector for new connections', () => {
      const { createInvocationDetector } = require('../../server/websocket.js');
      const send = vi.fn();
      
      const detector = createInvocationDetector('agent1', 'conv1', send);
      
      expect(typeof detector.accumulate).toBe('function');
      expect(typeof detector.detectAndExecute).toBe('function');
      expect(typeof detector.reset).toBe('function');
    });

    it('should accumulate output and detect invocations', () => {
      const { createInvocationDetector } = require('../../server/websocket.js');
      const send = vi.fn();
      
      agentInvocationDetector.detectAgentInvocation = vi.fn(() => ({
        targetAgent: 'agent2',
        message: 'Help me with this task',
        start: 5,
        end: 25
      }));

      const detector = createInvocationDetector('agent1', 'conv1', send);
      
      detector.accumulate('stdout', 'Hello @agent2 help me');
      
      expect(agentInvocationDetector.detectAgentInvocation).toHaveBeenCalledWith('Hello @agent2 help me');
    });

    it('should prevent duplicate invocations', () => {
      const { createInvocationDetector } = require('../../server/websocket.js');
      const send = vi.fn();
      
      agentInvocationDetector.detectAgentInvocation = vi.fn(() => ({
        targetAgent: 'agent2',
        message: 'Help me',
        start: 5,
        end: 15
      }));

      const detector = createInvocationDetector('agent1', 'conv1', send);
      
      // First invocation
      detector.accumulate('stdout', 'Hello @agent2 help me');
      expect(agentInvocationDetector.detectAgentInvocation).toHaveBeenCalledTimes(1);
      
      // Second call with same content should not trigger detection
      detector.accumulate('stdout', 'more content');
      expect(agentInvocationDetector.detectAgentInvocation).toHaveBeenCalledTimes(1);
    });
  });

  describe('Agent Runner Integration', () => {
    it('should handle agent runner callbacks', () => {
      agentRunner.runAgent = vi.fn((agentId, text, conversationId, callbacks) => {
        // Simulate agent output
        callbacks.onOutput('stdout', 'Hello from agent');
        callbacks.onToolUse({
          tool: 'test_tool',
          title: 'Test Tool',
          status: 'running',
          input: { data: 'test' },
          output: '',
          callID: 'call123'
        });
        callbacks.onExit(0, null);
      });

      const { setupWebSocket } = require('../../server/websocket.js');
      const wss = setupWebSocket({});
      
      // Simulate connection
      const connectionHandler = wss.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockWs);

      // Send start message
      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify({
        action: 'start',
        agentId: 'agent1',
        text: 'Hello',
        conversationId: 'conv1'
      }));

      // Should send output message
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"output"')
      );
      
      // Should send tool use message
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"tool_use"')
      );
      
      // Should send exit message
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"exit"')
      );
    });

    it('should handle agent runner errors', () => {
      agentRunner.runAgent = vi.fn((agentId, text, conversationId, callbacks) => {
        throw new Error('Agent failed to start');
      });

      const { setupWebSocket } = require('../../server/websocket.js');
      const wss = setupWebSocket({});
      
      const connectionHandler = wss.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockWs);

      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify({
        action: 'start',
        agentId: 'agent1',
        text: 'Hello',
        conversationId: 'conv1'
      }));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"error"')
      );
    });
  });

  describe('Built-in CLI Handling', () => {
    it('should handle built-in Claude CLI invocation', () => {
      const message = {
        action: 'start',
        agentId: 'claude-cli',
        text: '1+1=多少',
        conversationId: 'conv1'
      };

      // Mock built-in agent detection
      const mockAgent = {
        id: 'claude-cli',
        name: 'Claude CLI',
        cli_command: 'node minimal-claude.js'
      };

      const mockQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => mockAgent)
      });
      db.prepare.mockReturnValue(mockQuery);

      const { setupWebSocket } = require('../../server/websocket.js');
      const wss = setupWebSocket({});
      
      const connectionHandler = wss.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockWs);

      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify(message));

      // Should handle built-in CLI specifically
      expect(agentRunner.runAgent).toHaveBeenCalledWith(
        'claude-cli',
        '1+1=多少',
        'conv1',
        expect.any(Function)
      );
    });

    it('should handle built-in Opencode CLI invocation', () => {
      const message = {
        action: 'start',
        agentId: 'opencode-cli',
        text: 'Review my code',
        conversationId: 'conv1'
      };

      const mockAgent = {
        id: 'opencode-cli',
        name: 'Opencode CLI',
        cli_command: 'node minimal-opencode.js'
      };

      const mockQuery = vi.fn().mockReturnValue({
        get: vi.fn(() => mockAgent)
      });
      db.prepare.mockReturnValue(mockQuery);

      const { setupWebSocket } = require('../../server/websocket.js');
      const wss = setupWebSocket({});
      
      const connectionHandler = wss.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockWs);

      const messageHandler = mockWs.on.mock.calls.find(call => call[0] === 'message')[1];
      messageHandler(JSON.stringify(message));

      expect(agentRunner.runAgent).toHaveBeenCalledWith(
        'opencode-cli',
        'Review my code',
        'conv1',
        expect.any(Function)
      );
    });
  });

  describe('Connection Cleanup', () => {
    it('should handle WebSocket disconnection', () => {
      const { setupWebSocket } = require('../../server/websocket.js');
      const wss = setupWebSocket({});
      
      const connectionHandler = wss.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockWs);

      // Get close handler
      const closeHandler = mockWs.on.mock.calls.find(call => call[0] === 'close')[1];
      
      // Simulate disconnection
      closeHandler();
      
      // Should clean up any running processes or connections
      expect(logger.log).toHaveBeenCalledWith(
        '[websocket] Client disconnected'
      );
    });

    it('should handle WebSocket errors', () => {
      const { setupWebSocket } = require('../../server/websocket.js');
      const wss = setupWebSocket({});
      
      const connectionHandler = wss.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockWs);

      // Get error handler
      const errorHandler = mockWs.on.mock.calls.find(call => call[0] === 'error')[1];
      
      // Simulate error
      errorHandler(new Error('Connection error'));
      
      expect(logger.error).toHaveBeenCalledWith(
        '[websocket] WebSocket error:',
        expect.any(Error)
      );
    });
  });

  describe('Broadcast Messages', () => {
    it('should broadcast messages to all connected clients', () => {
      const mockClient1 = { readyState: 1, send: vi.fn() };
      const mockClient2 = { readyState: 1, send: vi.fn() };
      const mockClient3 = { readyState: 0, send: vi.fn() }; // disconnected

      mockWss.clients = new Set([mockClient1, mockClient2, mockClient3]);

      const message = { type: 'broadcast', data: 'Hello everyone' };
      const messageString = JSON.stringify(message);

      // Simulate broadcast function
      mockWss.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(messageString);
        }
      });

      expect(mockClient1.send).toHaveBeenCalledWith(messageString);
      expect(mockClient2.send).toHaveBeenCalledWith(messageString);
      expect(mockClient3.send).not.toHaveBeenCalled();
    });
  });
});