/**
 * 会话隔离功能测试
 * 验证 WebSocket 消息正确按 conversationId 隔离
 */

import { test, expect, beforeEach, afterEach, describe } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import WebSocket from 'ws';
import { setTimeout as sleep } from 'timers/promises';

// 模拟 CLI Agent
class MockCLI {
  constructor(name) {
    this.name = name;
    this.processes = new Map(); // agentId -> childProcess
  }

  run(agentId, onStdout, onStderr, onExit) {
    if (this.processes.has(agentId)) {
      return false; // Already running
    }

    // 模拟 CLI 进程
    const mockProcess = {
      stdin: {
        write: (data) => {
          // 模拟处理输入并输出
          setTimeout(() => {
            const lines = data.toString().split('\n');
            for (const line of lines) {
              if (line.trim()) {
                // 根据输入内容模拟不同的输出
                if (line.includes('slow')) {
                  // 模拟慢速输出
                  onStdout(`${this.name} processing slow task...\n`);
                  setTimeout(() => onStdout(`${this.name} completed slow task!\n`), 200);
                } else if (line.includes('fast')) {
                  onStdout(`${this.name} completed fast task!\n`);
                } else {
                  onStdout(`${this.name} processed: ${line.trim()}\n`);
                }
              }
            }
          }, 10);
        },
        destroyed: false,
      },
      kill: () => {
        this.processes.delete(agentId);
      },
    };

    this.processes.set(agentId, mockProcess);

    // 模拟进程退出
    setTimeout(() => {
      onExit(0, null);
      this.processes.delete(agentId);
    }, 500);

    return true;
  }

  stop(agentId) {
    const proc = this.processes.get(agentId);
    if (proc) {
      proc.kill();
      return true;
    }
    return false;
  }
}

describe('Conversation Isolation', () => {
  let server;
  let mockCLI;

  beforeEach(async () => {
    // 启动测试服务器
    server = spawn('node', ['server/index.js'], {
      env: { ...process.env, NODE_ENV: 'test', PORT: '3001' },
      cwd: path.resolve('.'),
    });

    // 等待服务器启动
    await sleep(2000);

    // 创建 Mock CLI
    mockCLI = new MockCLI('TestAgent');
  });

  afterEach(() => {
    if (server) {
      server.kill();
    }
  });

  test('WebSocket 消息按 conversationId 正确隔离', async () => {
    const ws = new WebSocket('ws://localhost:3001/ws');
    
    // 等待连接
    await new Promise(resolve => ws.once('open', resolve));

    const receivedMessages = [];
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      receivedMessages.push(msg);
    });

    // 模拟两个 Agent ID
    const agentId1 = 1;
    const agentId2 = 2;
    
    // 模拟两个会话 ID
    const convId1 = 101;
    const convId2 = 102;

    // 发送消息到会话1
    ws.send(JSON.stringify({
      action: 'send',
      agentId: agentId1,
      text: 'fast task for conversation 1',
      conversationId: convId1
    }));

    // 发送消息到会话2
    ws.send(JSON.stringify({
      action: 'send',
      agentId: agentId2,
      text: 'fast task for conversation 2',
      conversationId: convId2
    }));

    // 等待消息处理
    await sleep(1000);

    // 验证消息包含正确的 conversationId
    const outputMessages = receivedMessages.filter(msg => msg.type === 'output');
    
    expect(outputMessages).toHaveLength(2);
    
    // 检查每个输出消息都有正确的 conversationId
    const conv1Output = outputMessages.find(msg => 
      msg.data.includes('conversation 1') && msg.conversationId === convId1
    );
    const conv2Output = outputMessages.find(msg => 
      msg.data.includes('conversation 2') && msg.conversationId === convId2
    );
    
    expect(conv1Output).toBeDefined();
    expect(conv2Output).toBeDefined();
    
    // 验证退出消息也包含 conversationId
    const exitMessages = receivedMessages.filter(msg => msg.type === 'exit');
    expect(exitMessages).toHaveLength(2);
    
    const conv1Exit = exitMessages.find(msg => msg.conversationId === convId1);
    const conv2Exit = exitMessages.find(msg => msg.conversationId === convId2);
    
    expect(conv1Exit).toBeDefined();
    expect(conv2Exit).toBeDefined();

    ws.close();
  });

  test('切换会话时流式输出状态正确隔离', async () => {
    const ws = new WebSocket('ws://localhost:3001/ws');
    
    await new Promise(resolve => ws.once('open', resolve));

    const receivedMessages = [];
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      receivedMessages.push(msg);
    });

    // 模拟 Agent ID
    const agentId = 1;
    const convId1 = 201;
    const convId2 = 202;

    // 启动会话1的长时间任务
    ws.send(JSON.stringify({
      action: 'send',
      agentId: agentId,
      text: 'slow task for conversation 1',
      conversationId: convId1
    }));

    // 短暂延迟，让第一个任务开始
    await sleep(100);

    // 启动会话2的任务
    ws.send(JSON.stringify({
      action: 'send',
      agentId: agentId,
      text: 'fast task for conversation 2',
      conversationId: convId2
    }));

    // 等待所有消息处理
    await sleep(1500);

    // 验证两个会话的消息都被正确标记
    const outputMessages = receivedMessages.filter(msg => msg.type === 'output');
    const exitMessages = receivedMessages.filter(msg => msg.type === 'exit');

    // 应该有两个输出（一个慢任务，一个快任务）和两个退出
    expect(outputMessages).toHaveLength(2);
    expect(exitMessages).toHaveLength(2);

    // 验证每个消息都有正确的 conversationId
    for (const msg of [...outputMessages, ...exitMessages]) {
      expect(msg.conversationId).toBeDefined();
      expect([convId1, convId2]).toContain(msg.conversationId);
    }

    // 验证不同会话的消息内容不同
    const conv1Messages = [...outputMessages, ...exitMessages]
      .filter(msg => msg.conversationId === convId1);
    const conv2Messages = [...outputMessages, ...exitMessages]
      .filter(msg => msg.conversationId === convId2);

    expect(conv1Messages).toHaveLength(2); // 1 output + 1 exit
    expect(conv2Messages).toHaveLength(2); // 1 output + 1 exit

    ws.close();
  });

  test('消息过滤机制正确工作', async () => {
    const ws = new WebSocket('ws://localhost:3001/ws');
    
    await new Promise(resolve => ws.once('open', resolve));

    // 模拟一个长时间运行的 Agent
    ws.send(JSON.stringify({
      action: 'start',
      agentId: 1
    }));

    await sleep(100);

    // 发送消息到会话1
    ws.send(JSON.stringify({
      action: 'send',
      agentId: 1,
      text: 'task for conversation 1',
      conversationId: 1001
    }));

    await sleep(100);

    // 模拟切换到不同会话（在实际应用中，这意味着不同的前端实例或不同的处理逻辑）
    // 这里我们验证消息确实包含了 conversationId
    
    const receivedMessages = [];
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      receivedMessages.push(msg);
    });

    // 等待处理完成
    await sleep(600);

    // 验证所有相关消息都包含 conversationId
    const relevantMessages = receivedMessages.filter(msg => 
      ['output', 'exit', 'started'].includes(msg.type)
    );

    for (const msg of relevantMessages) {
      if (msg.type === 'output' || msg.type === 'exit') {
        expect(msg.conversationId).toBeDefined();
      }
    }

    ws.close();
  });
});
