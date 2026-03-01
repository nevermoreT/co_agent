import { useState, memo, Component } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import './MarkdownRenderer.css';

/**
 * 错误边界组件 - 捕获子组件的渲染错误
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <span className="error-boundary-icon">⚠️</span>
          <span className="error-boundary-text">
            {this.props.fallback || '渲染出错'}
          </span>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Markdown 渲染器组件
 * 支持：代码块、列表、表格、任务列表、引用等
 * 使用 React.memo 避免内容未变时重复解析渲染
 */
export const MarkdownRenderer = memo(function MarkdownRenderer({ content, className = '' }) {
  if (!content) return null;
  
  // 确保 content 是字符串
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

  return (
    <ErrorBoundary fallback="Markdown 渲染出错">
      <div className={`markdown-renderer ${className}`}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
          // 代码块
          code({ inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? (
              <div className="code-block-wrapper">
                <div className="code-block-header">
                  <span className="code-block-language">{match[1]}</span>
                </div>
                <pre className={className} {...props}>
                  <code>{children}</code>
                </pre>
              </div>
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          // 任务列表（Todo 列表）
          li({ children, ...props }) {
            const content = String(children);
            // 识别 GitHub 风格的任务列表 - [ ] 和 - [x]
            if (content.startsWith('[ ] ')) {
              return (
                <li className="task-item task-pending" {...props}>
                  <input type="checkbox" disabled />
                  <span className="task-content">{content.slice(4)}</span>
                </li>
              );
            }
            if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
              return (
                <li className="task-item task-completed" {...props}>
                  <input type="checkbox" checked disabled />
                  <span className="task-content task-completed-text">{content.slice(4)}</span>
                </li>
              );
            }
            return <li {...props}>{children}</li>;
          },
          // 表格
          table({ children }) {
            return (
              <div className="table-wrapper">
                <table>{children}</table>
              </div>
            );
          },
          // 引用块
          blockquote({ children }) {
            return <blockquote className="blockquote">{children}</blockquote>;
          },
        }}
      >
        {contentStr}
      </ReactMarkdown>
    </div>
    </ErrorBoundary>
  );
});

/**
 * Thinking 消息组件 - 折叠面板显示思考过程
 */
export function ThinkingMessage({ content, agentName }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="thinking-message">
      <button
        className="thinking-header"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        <span className="thinking-icon">{isExpanded ? '▼' : '▶'}</span>
        <span className="thinking-title">
          {agentName} 的思考过程
          <span className="thinking-count">
            {isExpanded ? '（点击折叠）' : `（点击展开，${content.length} 字符）`}
          </span>
        </span>
      </button>
      {isExpanded && (
        <div className="thinking-content">
          <MarkdownRenderer content={content} />
        </div>
      )}
    </div>
  );
}

/**
 * 图片消息组件
 */
export function ImageMessage({ src, alt, caption }) {
  return (
    <div className="image-message">
      <img src={src} alt={alt || caption} />
      {caption && <span className="image-caption">{caption}</span>}
    </div>
  );
}

/**
 * 工具调用消息组件 - 折叠面板显示工具调用
 */
export function ToolUseMessage({ toolCalls }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  if (!toolCalls || toolCalls.length === 0) return null;
  
  const count = toolCalls.length;
  const firstTool = toolCalls[0];
  
  // 安全地格式化输出内容
  const formatOutput = (output) => {
    if (!output) return null;
    if (typeof output === 'string') return output;
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  };
  
  // 安全地获取 input 的 keys
  const getInputKeys = (input) => {
    if (!input || typeof input !== 'object') return [];
    try {
      return Object.keys(input);
    } catch {
      return [];
    }
  };
  
  return (
    <div className="tool-use-message">
      <button
        className="tool-use-header"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        <span className="tool-use-icon">{isExpanded ? '▼' : '▶'}</span>
        <span className="tool-use-title">
          <span className="tool-use-count">{count} 个工具调用</span>
          <span className="tool-use-summary">{firstTool.title || firstTool.tool}</span>
        </span>
        <span className="tool-use-status">{toolCalls.every(t => t.status === 'completed') ? '✓' : '...'}</span>
      </button>
      {isExpanded && (
        <div className="tool-use-content">
          {toolCalls.map((tc, idx) => {
            const inputKeys = getInputKeys(tc.input);
            const outputStr = formatOutput(tc.output);
            
            return (
              <div key={idx} className="tool-use-item">
                <div className="tool-use-item-header">
                  <span className="tool-use-item-tool">{tc.tool || 'unknown'}</span>
                  <span className={`tool-use-item-status ${tc.status || 'unknown'}`}>
                    {tc.status || 'unknown'}
                  </span>
                </div>
                {tc.title && tc.title !== tc.tool && (
                  <div className="tool-use-item-title">{tc.title}</div>
                )}
                {inputKeys.length > 0 && (
                  <div className="tool-use-item-input">
                    <div className="tool-use-item-label">参数:</div>
                    <pre className="tool-use-item-code">
                      {JSON.stringify(tc.input, null, 2)}
                    </pre>
                  </div>
                )}
                {outputStr && (
                  <div className="tool-use-item-output">
                    <div className="tool-use-item-label">结果:</div>
                    <div className="tool-use-item-result">
                      {outputStr.length > 500 ? (
                        <pre className="tool-use-item-code">{outputStr}</pre>
                      ) : (
                        <MarkdownRenderer content={outputStr} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 解析消息内容，提取工具调用和普通文本
 * 工具调用格式：[[TOOL_USE:{json}]]
 */
export function parseMessageContent(content) {
  if (!content) return { toolCalls: [], textParts: [] };
  
  const toolCalls = [];
  const textParts = [];
  const startMarker = '[[TOOL_USE:';
  const endMarker = ']]';
  
  let i = 0;
  let lastTextStart = 0;
  
  while (i < content.length) {
    const startIdx = content.indexOf(startMarker, i);
    if (startIdx === -1) break;
    
    if (startIdx > lastTextStart) {
      textParts.push(content.substring(lastTextStart, startIdx));
    }
    
    const jsonStart = startIdx + startMarker.length;
    let braceCount = 0;
    let jsonEnd = -1;
    
    for (let j = jsonStart; j < content.length; j++) {
      if (content[j] === '{') braceCount++;
      else if (content[j] === '}') {
        braceCount--;
        if (braceCount === 0) {
          if (content.substring(j + 1, j + 1 + endMarker.length) === endMarker) {
            jsonEnd = j + 1;
            break;
          }
        }
      }
    }
    
    if (jsonEnd !== -1) {
      const jsonStr = content.substring(jsonStart, jsonEnd);
      try {
        const toolData = JSON.parse(jsonStr);
        toolCalls.push(toolData);
      } catch {
        // JSON 解析失败
      }
      lastTextStart = jsonEnd + endMarker.length;
      i = lastTextStart;
    } else {
      i = startIdx + 1;
    }
  }
  
  if (lastTextStart < content.length) {
    textParts.push(content.substring(lastTextStart));
  }
  
  return { toolCalls, textParts: textParts.filter(t => t.trim()) };
}
