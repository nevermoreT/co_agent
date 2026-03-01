/**
 * 会话隔离单元测试 - 测试 App.jsx 中的状态管理逻辑
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, useMemo } from 'react';

// 模拟 App.jsx 中的会话隔离逻辑
function useConversationIsolation() {
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
  const handleOnOutput = (agentId, data, msgConversationId) => {
    // 如果消息带有 conversationId，说明这是特定会话的消息
    if (msgConversationId != null) {
      // 即使用户已切换到其他会话，仍应将此消息存储到正确的会话中
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
        
        if (!streamingRefByConversation.current[msgConversationId]) {
          streamingRefByConversation.current[msgConversationId] = {};
        }
        streamingRefByConversation.current[msgConversationId][agentId] = 
          (streamingRefByConversation.current[msgConversationId][agentId] || '') + data;
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
      });
    }
  };

  // 模拟 WebSocket onExit 回调
  const handleOnExit = (agentId, msgConversationId) => {
    const targetConversationId = msgConversationId != null ? msgConversationId : selectedConversationId;
    
    act(() => {
      // 清理该会话的流式状态
      delete streamingRefByConversation.current[targetConversationId]?.[agentId];
      
      setStreamingByConversation((prev) => {
        const prevConv = prev[targetConversationId] || {};
        const { [agentId]: _, ...rest } = prevConv;
        return {
          ...prev,
          [targetConversationId]: rest,
        };
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
    handleOnOutput,
    handleOnExit,
  };
}

describe('Conversation Isolation Logic', () => {
  it('should isolate streaming states by conversationId', () => {
    const { result } = renderHook(() => useConversationIsolation());

    // 选中会话1
    act(() => {
      result.current.setSelectedConversationId(101);
    });

    // 为会话1添加流式输出
    act(() => {
      result.current.handleOnOutput(1, 'Output for conversation 1', 101);
    });

    // 验证会话1有输出
    expect(result.current.streaming[1]).toBe('Output for conversation 1');

    // 选中会话2
    act(() => {
      result.current.setSelectedConversationId(102);
    });

    // 验证会话2没有会话1的输出
    expect(result.current.streaming[1]).toBeUndefined();

    // 为会话2添加流式输出
    act(() => {
      result.current.handleOnOutput(1, 'Output for conversation 2', 102);
    });

    // 验证会话2有自己的输出
    expect(result.current.streaming[1]).toBe('Output for conversation 2');

    // 切换回会话1，验证它的输出仍然存在
    act(() => {
      result.current.setSelectedConversationId(101);
    });

    expect(result.current.streaming[1]).toBe('Output for conversation 1');
  });

  it('should handle messages with and without conversationId correctly', () => {
    const { result } = renderHook(() => useConversationIsolation());

    // 选中会话1
    act(() => {
      result.current.setSelectedConversationId(101);
    });

    // 发送带 conversationId 的消息（到会话101）
    act(() => {
      result.current.handleOnOutput(1, 'Message for conv 101', 101);
    });

    // 发送不带 conversationId 的消息（应该使用当前选中的会话101）
    act(() => {
      result.current.handleOnOutput(1, ' + Message for current conv', null);
    });

    // 验证两种消息都被正确处理到同一个会话（因为当前选中的也是101）
    expect(result.current.streaming[1]).toBe('Message for conv 101 + Message for current conv');

    // 检查全局状态中会话101有累积的消息
    const allStates = result.current.streamingByConversation;
    expect(allStates[101][1]).toBe('Message for conv 101 + Message for current conv');
  });

  it('should properly clean up states on exit', () => {
    const { result } = renderHook(() => useConversationIsolation());

    // 选中会话1
    act(() => {
      result.current.setSelectedConversationId(101);
    });

    // 添加一些输出
    act(() => {
      result.current.handleOnOutput(1, 'Some output', 101);
    });

    // 验证输出存在
    expect(result.current.streamingByConversation[101][1]).toBe('Some output');

    // 模拟退出事件
    act(() => {
      result.current.handleOnExit(1, 101);
    });

    // 验证状态已被清理
    expect(result.current.streamingByConversation[101][1]).toBeUndefined();
  });

  it('should maintain separate states for different conversations', () => {
    const { result } = renderHook(() => useConversationIsolation());

    // 为多个会话添加消息
    act(() => {
      result.current.handleOnOutput(1, 'Conv 1 - Part 1', 101);
      result.current.handleOnOutput(1, 'Conv 1 - Part 2', 101);
      result.current.handleOnOutput(2, 'Conv 2 - Part 1', 102);
      result.current.handleOnOutput(2, 'Conv 2 - Part 2', 102);
      result.current.handleOnOutput(3, 'Conv 3 - Part 1', 103);
    });

    // 验证每个会话都有自己的状态
    const allStates = result.current.streamingByConversation;
    
    expect(allStates[101][1]).toBe('Conv 1 - Part 1Conv 1 - Part 2');
    expect(allStates[102][2]).toBe('Conv 2 - Part 1Conv 2 - Part 2');
    expect(allStates[103][3]).toBe('Conv 3 - Part 1');
    
    // 验证没有交叉污染
    expect(allStates[101][2]).toBeUndefined(); // Conv 1 不应该有 agent 2 的消息
    expect(allStates[102][1]).toBeUndefined(); // Conv 2 不应该有 agent 1 的消息
  });
});