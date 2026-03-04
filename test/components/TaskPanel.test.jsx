import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaskPanel from '../../client/components/TaskPanel.jsx';
import fetch from 'node-fetch';

// Mock fetch
vi.mock('node-fetch');

describe('TaskPanel Component', () => {
  const mockTasks = [
    { id: 1, title: 'Task 1', group_name: 'Group 1', created_at: '2023-01-01T00:00:00.000Z', last_activity_at: '2023-01-01T01:00:00.000Z' },
    { id: 2, title: 'Task 2', group_name: 'Group 2', created_at: '2023-01-02T00:00:00.000Z', last_activity_at: '2023-01-02T01:00:00.000Z' }
  ];

  const mockProps = {
    tasks: mockTasks,
    loading: false,
    refetch: vi.fn(),
    selectedTaskId: 1,
    onSelectTask: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetch.mockClear();
    
    // Default fetch mock for successful responses
    fetch.mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({})
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should render task list', () => {
      render(<TaskPanel {...mockProps} />);
      
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
      expect(screen.getByText('Group 1')).toBeInTheDocument();
      expect(screen.getByText('Group 2')).toBeInTheDocument();
    });

    it('should render loading state', () => {
      render(<TaskPanel {...mockProps} loading={true} />);
      
      expect(screen.getByText('加载中...')).toBeInTheDocument();
    });

    it('should render empty state when no tasks', () => {
      render(<TaskPanel {...mockProps} tasks={[]} />);
      
      expect(screen.getByText('暂无对话')).toBeInTheDocument();
    });

    it('should show new task button', () => {
      render(<TaskPanel {...mockProps} />);
      
      expect(screen.getByText('新对话')).toBeInTheDocument();
    });

    it('should highlight selected task', () => {
      render(<TaskPanel {...mockProps} selectedTaskId={1} />);
      
      const task1 = screen.getByText('Task 1').closest('.task-item');
      expect(task1).toHaveClass('selected');
    });
  });

  describe('Task Creation', () => {
    it('should open new task form when clicking new button', () => {
      render(<TaskPanel {...mockProps} />);
      
      const newButton = screen.getByText('新对话');
      fireEvent.click(newButton);
      
      expect(screen.getByPlaceholderText('任务标题')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('分组名称（可选）')).toBeInTheDocument();
    });

    it('should save new task when form is submitted', async () => {
      const mockResponse = { id: 3, title: 'New Task', group_name: 'New Group' };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      render(<TaskPanel {...mockProps} />);
      
      // Open new task form
      const newButton = screen.getByText('新对话');
      fireEvent.click(newButton);
      
      // Fill form
      const titleInput = screen.getByPlaceholderText('任务标题');
      fireEvent.change(titleInput, { target: { value: 'New Task' } });
      
      const groupInput = screen.getByPlaceholderText('分组名称（可选）');
      fireEvent.change(groupInput, { target: { value: 'New Group' } });
      
      // Save
      const saveButton = screen.getByText('保存');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/tasks',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'New Task', group_name: 'New Group' })
          }
        );
      });
      
      expect(mockProps.refetch).toHaveBeenCalled();
      expect(mockProps.onSelectTask).toHaveBeenCalledWith(3);
    });

    it('should not save task with empty title', async () => {
      render(<TaskPanel {...mockProps} />);
      
      const newButton = screen.getByText('新对话');
      fireEvent.click(newButton);
      
      // Try to save without title
      const saveButton = screen.getByText('保存');
      fireEvent.click(saveButton);
      
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should close form when cancel is clicked', () => {
      render(<TaskPanel {...mockProps} />);
      
      const newButton = screen.getByText('新对话');
      fireEvent.click(newButton);
      
      expect(screen.getByPlaceholderText('任务标题')).toBeInTheDocument();
      
      const cancelButton = screen.getByText('取消');
      fireEvent.click(cancelButton);
      
      expect(screen.queryByPlaceholderText('任务标题')).not.toBeInTheDocument();
    });
  });

  describe('Task Editing', () => {
    it('should open edit form for existing task', () => {
      render(<TaskPanel {...mockProps} />);
      
      // Right click on task to open context menu
      const task1 = screen.getByText('Task 1');
      fireEvent.contextMenu(task1);
      
      expect(screen.getByText('编辑')).toBeInTheDocument();
      
      // Click edit
      const editButton = screen.getByText('编辑');
      fireEvent.click(editButton);
      
      const titleInput = screen.getByDisplayValue('Task 1');
      expect(titleInput).toBeInTheDocument();
    });

    it('should save edited task', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({})
      });

      render(<TaskPanel {...mockProps} />);
      
      // Open edit form
      const task1 = screen.getByText('Task 1');
      fireEvent.contextMenu(task1);
      
      const editButton = screen.getByText('编辑');
      fireEvent.click(editButton);
      
      // Edit title
      const titleInput = screen.getByDisplayValue('Task 1');
      fireEvent.change(titleInput, { target: { value: 'Edited Task' } });
      
      // Save
      const saveButton = screen.getByText('保存');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/tasks/1',
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'Edited Task', group_name: 'Group 1' })
          }
        );
      });
      
      expect(mockProps.refetch).toHaveBeenCalled();
    });
  });

  describe('Task Deletion', () => {
    it('should show delete option in context menu', () => {
      render(<TaskPanel {...mockProps} />);
      
      const task1 = screen.getByText('Task 1');
      fireEvent.contextMenu(task1);
      
      expect(screen.getByText('删除')).toBeInTheDocument();
    });

    it('should delete task when delete is confirmed', async () => {
      // Mock window.confirm
      const originalConfirm = window.confirm;
      window.confirm = vi.fn(() => true);

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({})
      });

      render(<TaskPanel {...mockProps} />);
      
      const task1 = screen.getByText('Task 1');
      fireEvent.contextMenu(task1);
      
      const deleteButton = screen.getByText('删除');
      fireEvent.click(deleteButton);
      
      expect(window.confirm).toHaveBeenCalledWith('确定删除该对话？所有消息将被删除。');
      
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith(
          '/api/tasks/1',
          { method: 'DELETE' }
        );
      });
      
      expect(mockProps.refetch).toHaveBeenCalled();
      
      // Restore original confirm
      window.confirm = originalConfirm;
    });

    it('should not delete task when delete is cancelled', () => {
      const originalConfirm = window.confirm;
      window.confirm = vi.fn(() => false);

      render(<TaskPanel {...mockProps} />);
      
      const task1 = screen.getByText('Task 1');
      fireEvent.contextMenu(task1);
      
      const deleteButton = screen.getByText('删除');
      fireEvent.click(deleteButton);
      
      expect(window.confirm).toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      
      window.confirm = originalConfirm;
    });

    it('should clear selected task when deleted task is selected', async () => {
      const originalConfirm = window.confirm;
      window.confirm = vi.fn(() => true);

      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({})
      });

      render(<TaskPanel {...mockProps} selectedTaskId={1} />);
      
      const task1 = screen.getByText('Task 1');
      fireEvent.contextMenu(task1);
      
      const deleteButton = screen.getByText('删除');
      fireEvent.click(deleteButton);
      
      await waitFor(() => {
        expect(mockProps.onSelectTask).toHaveBeenCalledWith(null);
      });
      
      window.confirm = originalConfirm;
    });
  });

  describe('Task Selection', () => {
    it('should select task when clicked', () => {
      render(<TaskPanel {...mockProps} />);
      
      const task2 = screen.getByText('Task 2');
      fireEvent.click(task2);
      
      expect(mockProps.onSelectTask).toHaveBeenCalledWith(2);
    });
  });

  describe('Context Menu', () => {
    it('should close context menu when clicking outside', () => {
      render(<TaskPanel {...mockProps} />);
      
      const task1 = screen.getByText('Task 1');
      fireEvent.contextMenu(task1);
      
      expect(screen.getByText('编辑')).toBeInTheDocument();
      
      // Click outside
      fireEvent.click(document.body);
      
      expect(screen.queryByText('编辑')).not.toBeInTheDocument();
    });

    it('should close context menu when action is taken', () => {
      render(<TaskPanel {...mockProps} />);
      
      const task1 = screen.getByText('Task 1');
      fireEvent.contextMenu(task1);
      
      expect(screen.getByText('编辑')).toBeInTheDocument();
      
      // Click edit
      const editButton = screen.getByText('编辑');
      fireEvent.click(editButton);
      
      expect(screen.queryByText('编辑')).not.toBeInTheDocument();
    });
  });

  describe('Task Preview Loading', () => {
    it('should fetch task previews on component mount', async () => {
      const mockPreview = { id: 1, preview: 'Preview content' };
      fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockPreview)
      });

      render(<TaskPanel {...mockProps} />);
      
      await waitFor(() => {
        expect(fetch).toHaveBeenCalledWith('/api/tasks/1/preview');
        expect(fetch).toHaveBeenCalledWith('/api/tasks/2/preview');
      });
    });

    it('should not fetch preview for already loaded tasks', async () => {
      const mockPreviews = { 1: { id: 1, preview: 'Preview 1' } };
      
      render(<TaskPanel {...mockProps} />);
      
      // Manually set previews to simulate already loaded state
      const { rerender } = render(
        <TaskPanel {...mockProps} />
      );
      
      // The component should not try to fetch preview for task 1 again
      expect(fetch).not.toHaveBeenCalledWith('/api/tasks/1/preview');
    });

    it('should handle preview fetch errors gracefully', async () => {
      fetch.mockRejectedValueOnce(new Error('Network error'));

      render(<TaskPanel {...mockProps} />);
      
      // Component should not crash
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
    });
  });

  describe('Time Formatting', () => {
    it('should display relative time correctly', () => {
      const recentTask = [
        { 
          id: 1, 
          title: 'Recent Task', 
          group_name: 'Group 1', 
          created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
          last_activity_at: new Date(Date.now() - 5 * 60 * 1000).toISOString()
        }
      ];

      render(<TaskPanel {...mockProps} tasks={recentTask} />);
      
      expect(screen.getByText('5分钟前')).toBeInTheDocument();
    });

    it('should display "刚刚" for very recent tasks', () => {
      const veryRecentTask = [
        { 
          id: 1, 
          title: 'Very Recent Task', 
          group_name: 'Group 1', 
          created_at: new Date(Date.now() - 30 * 1000).toISOString(), // 30 seconds ago
          last_activity_at: new Date(Date.now() - 30 * 1000).toISOString()
        }
      ];

      render(<TaskPanel {...mockProps} tasks={veryRecentTask} />);
      
      expect(screen.getByText('刚刚')).toBeInTheDocument();
    });
  });

  describe('Grouping', () => {
    it('should group tasks by group_name', () => {
      const tasksWithGroups = [
        { id: 1, title: 'Task 1', group_name: 'Work', created_at: '2023-01-01T00:00:00.000Z', last_activity_at: '2023-01-01T01:00:00.000Z' },
        { id: 2, title: 'Task 2', group_name: 'Personal', created_at: '2023-01-02T00:00:00.000Z', last_activity_at: '2023-01-02T01:00:00.000Z' },
        { id: 3, title: 'Task 3', group_name: 'Work', created_at: '2023-01-03T00:00:00.000Z', last_activity_at: '2023-01-03T01:00:00.000Z' }
      ];

      render(<TaskPanel {...mockProps} tasks={tasksWithGroups} />);
      
      expect(screen.getByText('Work')).toBeInTheDocument();
      expect(screen.getByText('Personal')).toBeInTheDocument();
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.getByText('Task 2')).toBeInTheDocument();
      expect(screen.getByText('Task 3')).toBeInTheDocument();
    });

    it('should handle tasks without group', () => {
      const tasksWithoutGroup = [
        { id: 1, title: 'Task 1', group_name: null, created_at: '2023-01-01T00:00:00.000Z', last_activity_at: '2023-01-01T01:00:00.000Z' }
      ];

      render(<TaskPanel {...mockProps} tasks={tasksWithoutGroup} />);
      
      expect(screen.getByText('Task 1')).toBeInTheDocument();
      expect(screen.queryByText('null')).not.toBeInTheDocument();
    });
  });
});