/**
 * 会话隔离端到端测试 - 模拟用户切换会话的场景
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useMemo } from 'react';

// 模拟完整的 App.jsx 中的会话隔离逻辑
function useFullConversationIsolation() {
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  // 流式输出状态按 conversationId 隔离存储
  const [streamingByConversation, setStreamingByConversation] = useState({});
  const [streamingAgentIdByConversation, setStreamingAgentIdByConversation] = useState({});
  const [streamingToolCallsByConversation, setStreamingToolCallsByConversation] = useState({});
  const streamingRefByConversation = { current: {} };

  // 获取当前会话的流式输出状态
  const streaming = useMemo(() => {
    return streamingByConversation[selectedConversationId] || {};
  }, [streamingByConversation, selectedConversationId]);

  const streamingAgentId = useMemo(() => {
    return streamingAgentIdByConversation[selectedConversationId] || null;
  }, [streamingAgentIdByConversation, selectedConversationId]);

  const streamingToolCalls = useMemo(() => {
    return streamingToolCallsByConversation[selectedConversationId] || {};
  }, [streamingToolCallsByConversation, selectedConversationId]);

  const streamingRef = useMemo(() => {
    if (!streamingRefByConversation.current[selectedConversationId]) {
      streamingRefByConversation.current[selectedConversationId] = {};
    }
    return {
      current: streamingRefByConversation.current[selectedConversationId],
    };
  }, [selectedConversationId]);

  // 模拟 WebSocket onOutput 回调
  const handleOnOutput = (agentId, stream, data, msgConversationId) => {
    // 如果消息带有 conversationId，说明这是特定会话的消息
    if (msgConversationId != null) {
      // 即使用户已切换到其他会话，仍应将此消息存储到正确的会话中
      // 这样当用户切换回该会话时，可以看到完整的输出
      
      act(() => {
        setStreamingByConversation((prev) => {
          const prevConv = prev[msgConversationId] || {};
          const prevContent = prevConv[agentId] || '';
          return {
            ...prev,
            [msgConversationId]: {
              ...prevConv,
              [agentId]: prevContent + data,
            },
          };
        });
        
        // 更新 ref
        if (!streamingRefByConversation.current[msgConversationId]) {
          streamingRefByConversation.current[msgConversationId] = {};
        }
        streamingRefByConversation.current[msgConversationId][agentId] = 
          (streamingRefByConversation.current[msgConversationId][agentId] || '') + data;
        
        // 如果这是当前选中的会话，则更新活跃 Agent
        if (msgConversationId === selectedConversationId) {
          setStreamingAgentIdByConversation((prev) => ({
            ...prev,
            [selectedConversationId]: agentId,
          }));
        }
      });
    } else {
      // 没有 conversationId 的旧消息，按以前的方式处理（只更新当前会话）
      act(() => {
        setStreamingByConversation((prev) => {
          const prevConv = prev[selectedConversationId] || {};
          const prevContent = prevConv[agentId] || '';
          return {
            ...prev,
            [selectedConversationId]: {
              ...prevConv,
              [agentId]: prevContent + data,
            },
          };
        });
        
        if (!streamingRefByConversation.current[selectedConversationId]) {
          streamingRefByConversation.current[selectedConversationId] = {};
        }
        streamingRefByConversation.current[selectedConversationId][agentId] = 
          (streamingRefByConversation.current[selectedConversationId][agentId] || '') + data;
        
        setStreamingAgentIdByConversation((prev) => ({
          ...prev,
          [selectedConversationId]: agentId,
        }));
      });
    }
  };

  // 模拟 WebSocket onExit 回调
  const handleOnExit = (agentId, code, signal, msgConversationId) => {
    // 获取消息所属的会话 ID（如果存在）
    const targetConversationId = msgConversationId != null ? msgConversationId : selectedConversationId;
    
    act(() => {
      // 清理该会话的流式状态
      delete streamingRefByConversation.current[targetConversationId]?.[agentId];
      
      // 更新对应会话的流式内容状态
      setStreamingByConversation((prev) => {
        const prevConv = prev[targetConversationId] || {};
        const { [agentId]: _, ...rest } = prevConv;
        return {
          ...prev,
          [targetConversationId]: rest,
        };
      });
      
      setStreamingToolCallsByConversation((prev) => {
        const prevConv = prev[targetConversationId] || {};
        const { [agentId]: _, ...rest } = prevConv;
        return {
          ...prev,
          [targetConversationId]: rest,
        };
      });
      
      // 清理对应会话的活跃 Agent 状态
      setStreamingAgentIdByConversation((prev) => {
        const prevAgent = prev[targetConversationId];
        if (prevAgent === agentId) {
          const { [targetConversationId]: _, ...rest } = prev;
          return rest;
        }
        return prev;
      });
    });
  };

  return {
    selectedConversationId,
    setSelectedConversationId,
    streaming,
    streamingAgentId,
    streamingToolCalls,
    streamingRef,
    streamingByConversation,
    streamingAgentIdByConversation,
    handleOnOutput,
    handleOnExit,
  };
}

describe('Full Conversation Isolation Flow', () => {
  it('should maintain streaming states when switching conversations', () => {
    const { result } = renderHook(() => useFullConversationIsolation());

    // 场景：用户在会话1启动任务 -> 切换到会话2 -> 切换回会话1

    // 1. 选中会话1
    act(() => {
      result.current.setSelectedConversationId(101);
    });

    // 2. 在会话1中启动一个任务（模拟 Agent 输出）
    act(() => {
      result.current.handleOnOutput(1, 'stdout', 'Processing task...', 101);
    });

    // 3. 验证会话1有输出
    expect(result.current.streaming[1]).toBe('Processing task...');
    expect(result.current.streamingByConversation[101][1]).toBe('Processing task...');

    // 4. 切换到会话2
    act(() => {
      result.current.setSelectedConversationId(102);
    });

    // 5. 验证会话2没有会话1的输出
    expect(result.current.streaming[1]).toBeUndefined();
    expect(Object.keys(result.current.streaming).length).toBe(0);

    // 6. 模拟会话1的 Agent 继续输出（即使用户不在会话1中）
    act(() => {
      result.current.handleOnOutput(1, 'stdout', 'Task completed!', 101);
    });

    // 7. 验证会话1的输出已更新，但会话2仍然没有内容
    expect(result.current.streamingByConversation[101][1]).toBe('Processing task...Task completed!');
    expect(result.current.streamingByConversation[102]).toBeUndefined(); // 会话2仍然没有内容

    // 8. 切换回会话1
    act(() => {
      result.current.setSelectedConversationId(101);
    });

    // 9. 验证会话1有完整的输出
    expect(result.current.streaming[1]).toBe('Processing task...Task completed!');

    // 10. 在会话2中启动另一个任务
    act(() => {
      result.current.setSelectedConversationId(102);
    });

    act(() => {
      result.current.handleOnOutput(2, 'stdout', 'Session 2 task started', 102);
    });

    // 11. 验证会话2有自己的输出
    expect(result.current.streaming[2]).toBe('Session 2 task started');

    // 12. 切换回会话1，验证会话1的内容没有被影响
    act(() => {
      result.current.setSelectedConversationId(101);
    });

    expect(result.current.streaming[1]).toBe('Processing task...Task completed!');
    expect(result.current.streaming[2]).toBeUndefined(); // 会话2的内容不应该出现在会话1中
  });

  it('should handle multiple agents in different conversations', () => {
    const { result } = renderHook(() => useFullConversationIsolation());

    // 会话1中的 Agent 1
    act(() => {
      result.current.setSelectedConversationId(101);
    });
    act(() => {
      result.current.handleOnOutput(1, 'stdout', 'Agent 1 in Conv 1', 101);
    });

    // 会话1中的 Agent 2
    act(() => {
      result.current.handleOnOutput(2, 'stdout', 'Agent 2 in Conv 1', 101);
    });

    // 会话2中的 Agent 1
    act(() => {
      result.current.setSelectedConversationId(102);
    });
    act(() => {
      result.current.handleOnOutput(1, 'stdout', 'Agent 1 in Conv 2', 102);
    });

    // 验证隔离
    const allStates = result.current.streamingByConversation;
    
    // 会话1
    expect(allStates[101][1]).toBe('Agent 1 in Conv 1');
    expect(allStates[101][2]).toBe('Agent 2 in Conv 1');
    
    // 会话2
    expect(allStates[102][1]).toBe('Agent 1 in Conv 2');
    expect(allStates[102][2]).toBeUndefined(); // Agent 2 不应该在会话2中

    // 验证切换会话时显示正确内容
    act(() => {
      result.current.setSelectedConversationId(101);
    });
    expect(result.current.streaming[1]).toBe('Agent 1 in Conv 1');
    expect(result.current.streaming[2]).toBe('Agent 2 in Conv 1');

    act(() => {
      result.current.setSelectedConversationId(102);
    });
    expect(result.current.streaming[1]).toBe('Agent 1 in Conv 2');
    expect(result.current.streaming[2]).toBeUndefined(); // Agent 2 不在会话2中
  });

  it('should properly handle exit events for different conversations', () => {
    const { result } = renderHook(() => useFullConversationIsolation());

    // 设置会话1并添加一些输出
    act(() => {
      result.current.setSelectedConversationId(101);
    });
    act(() => {
      result.current.handleOnOutput(1, 'stdout', 'Some output', 101);
    });

    // 验证输出存在
    expect(result.current.streamingByConversation[101][1]).toBe('Some output');

    // 模拟 Agent 退出（来自会话101）
    act(() => {
      result.current.handleOnExit(1, 0, null, 101);
    });

    // 验证会话1的状态被清理
    expect(result.current.streamingByConversation[101][1]).toBeUndefined();

    // 添加新的输出到会话1
    act(() => {
      result.current.handleOnOutput(1, 'stdout', 'New output after reset', 101);
    });

    expect(result.current.streamingByConversation[101][1]).toBe('New output after reset');
  });
});