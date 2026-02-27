import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownRenderer, ThinkingMessage } from '../../client/components/MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders plain text correctly', () => {
    render(<MarkdownRenderer content="Plain text" />);
    expect(screen.getByText('Plain text')).toBeInTheDocument();
  });

  it('renders bold and italic text', () => {
    render(<MarkdownRenderer content="**Bold** and *italic*" />);
    expect(screen.getByText('Bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
  });

  it('renders inline code', () => {
    render(<MarkdownRenderer content="This is `inline code`" />);
    expect(screen.getByText('inline code')).toBeInTheDocument();
  });

  it('renders links', () => {
    render(<MarkdownRenderer content="[Link](https://example.com)" />);
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://example.com');
  });

  it('renders blockquotes', () => {
    render(<MarkdownRenderer content="> This is a quote" />);
    expect(screen.getByText('This is a quote')).toBeInTheDocument();
  });

  it('handles empty content', () => {
    const { container } = render(<MarkdownRenderer content="" />);
    expect(container.firstChild).toBeNull();
  });

  it('handles null content', () => {
    const { container } = render(<MarkdownRenderer content={null} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ThinkingMessage', () => {
  it('renders collapsed by default', () => {
    render(<ThinkingMessage content="Thinking content" agentName="Test Agent" />);
    expect(screen.getByText('Test Agent 的思考过程')).toBeInTheDocument();
    expect(screen.queryByText('Thinking content')).not.toBeInTheDocument();
  });

  it('expands when clicked', async () => {
    const user = userEvent.setup();
    render(<ThinkingMessage content="Thinking content" agentName="Test Agent" />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    
    expect(screen.getByText('Thinking content')).toBeInTheDocument();
  });

  it('collapses when clicked again', async () => {
    const user = userEvent.setup();
    render(<ThinkingMessage content="Thinking content" agentName="Test Agent" />);
    
    const header = screen.getByRole('button');
    await user.click(header);
    expect(screen.getByText('Thinking content')).toBeInTheDocument();
    
    await user.click(header);
    expect(screen.queryByText('Thinking content')).not.toBeInTheDocument();
  });
});