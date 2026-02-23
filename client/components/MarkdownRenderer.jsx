import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import './MarkdownRenderer.css';

/**
 * Markdown 渲染器组件
 * 支持：代码块、列表、表格、任务列表、引用等
 */
export function MarkdownRenderer({ content, className = '' }) {
  if (!content) return null;

  return (
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
        {content}
      </ReactMarkdown>
    </div>
  );
}

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
