import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ObjectUploader } from '@/components/ObjectUploader';
import Uppy from '@uppy/core';

// Track all Uppy instances created
const uppyInstances: any[] = [];

// Mock Uppy's core functionality
vi.mock('@uppy/core', () => {
  class MockUppy {
    private mockPlugins: any[] = [];
    private mockHandlers: Record<string, Function[]> = {};

    public use = vi.fn((plugin, config) => {
      this.mockPlugins.push({ plugin, config });
      return this;
    });

    public on = vi.fn((event: string, handler: Function) => {
      if (!this.mockHandlers[event]) {
        this.mockHandlers[event] = [];
      }
      this.mockHandlers[event].push(handler);
      return this;
    });

    public off = vi.fn((event: string, handler: Function) => {
      if (this.mockHandlers[event]) {
        const index = this.mockHandlers[event].indexOf(handler);
        if (index > -1) {
          this.mockHandlers[event].splice(index, 1);
        }
      }
      return this;
    });

    public getPlugins = vi.fn(() => [...this.mockPlugins]);

    public removePlugin = vi.fn((plugin) => {
      const index = this.mockPlugins.indexOf(plugin);
      if (index > -1) {
        this.mockPlugins.splice(index, 1);
      }
      return this;
    });

    public close = vi.fn((opts) => {
      // Clear all handlers when closing
      Object.keys(this.mockHandlers).forEach(key => {
        this.mockHandlers[key] = [];
      });
      this.mockPlugins.length = 0;
      return this;
    });

    constructor() {
      uppyInstances.push(this);
    }
  }

  return {
    default: MockUppy,
  };
});

// Mock Uppy plugins
vi.mock('@uppy/aws-s3', () => ({
  default: vi.fn(),
}));

vi.mock('@uppy/react/dashboard-modal', () => ({
  default: vi.fn(({ open, uppy }) => {
    if (!open) return null;
    return <div data-testid="uppy-dashboard-modal">Uppy Dashboard</div>;
  }),
}));

describe('ObjectUploader Memory Leak Prevention', () => {
  let mockGetUploadParameters: ReturnType<typeof vi.fn>;
  let mockOnComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetUploadParameters = vi.fn().mockResolvedValue({
      method: 'PUT',
      url: 'https://example.com/upload',
    });
    mockOnComplete = vi.fn();
    // Clear instances array before each test
    uppyInstances.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('should not accumulate event handlers after 20 mount/unmount cycles', () => {
    const cycles = 20;
    const initialCount = uppyInstances.length;

    for (let i = 0; i < cycles; i++) {
      const { unmount } = render(
        <ObjectUploader
          onGetUploadParameters={mockGetUploadParameters}
          onComplete={mockOnComplete}
        >
          Upload File
        </ObjectUploader>
      );

      unmount();
    }

    // Verify all instances were created
    expect(uppyInstances.length).toBe(initialCount + cycles);

    // Verify each instance was properly cleaned up
    uppyInstances.slice(initialCount).forEach((instance) => {
      // Check that 'off' was called to remove handlers
      expect(instance.off).toHaveBeenCalled();

      // Check that all plugins were removed
      expect(instance.removePlugin).toHaveBeenCalled();

      // Check that close was called with proper reason
      expect(instance.close).toHaveBeenCalledWith({ reason: 'unmount' });
    });
  });

  it('should remove "complete" event handler on unmount', () => {
    const { unmount } = render(
      <ObjectUploader
        onGetUploadParameters={mockGetUploadParameters}
        onComplete={mockOnComplete}
      >
        Upload File
      </ObjectUploader>
    );

    // Get the latest Uppy instance
    const instance = uppyInstances[uppyInstances.length - 1];

    expect(instance.on).toHaveBeenCalledWith('complete', expect.any(Function));

    unmount();

    // Verify the handler was removed
    expect(instance.off).toHaveBeenCalledWith('complete', expect.any(Function));
  });

  it('should remove all plugins on unmount', () => {
    const { unmount } = render(
      <ObjectUploader
        onGetUploadParameters={mockGetUploadParameters}
        onComplete={mockOnComplete}
      >
        Upload File
      </ObjectUploader>
    );

    const instance = uppyInstances[uppyInstances.length - 1];

    // Verify plugin was added
    expect(instance.use).toHaveBeenCalled();

    unmount();

    // Verify plugins were removed
    expect(instance.getPlugins).toHaveBeenCalled();
    expect(instance.removePlugin).toHaveBeenCalled();
  });

  it('should null out uppyRef after cleanup', () => {
    const initialCount = uppyInstances.length;

    const { unmount } = render(
      <ObjectUploader
        onGetUploadParameters={mockGetUploadParameters}
        onComplete={mockOnComplete}
      >
        Upload File
      </ObjectUploader>
    );

    // Component should render and create an instance
    expect(uppyInstances.length).toBe(initialCount + 1);

    unmount();

    // After unmount and remount, a new instance should be created
    render(
      <ObjectUploader
        onGetUploadParameters={mockGetUploadParameters}
        onComplete={mockOnComplete}
      >
        Upload File
      </ObjectUploader>
    );

    // Should have 2 instances now (one for each render)
    expect(uppyInstances.length).toBe(initialCount + 2);
  });

  it('should guard against double-close', () => {
    const { unmount } = render(
      <ObjectUploader
        onGetUploadParameters={mockGetUploadParameters}
        onComplete={mockOnComplete}
      >
        Upload File
      </ObjectUploader>
    );

    const instance = uppyInstances[uppyInstances.length - 1];

    unmount();

    // First unmount should call close
    expect(instance.close).toHaveBeenCalledTimes(1);

    // Unmounting again should not cause errors
    unmount();

    // Should still only have been called once
    expect(instance.close).toHaveBeenCalledTimes(1);
  });

  it('should not re-initialize Uppy on re-renders', () => {
    const initialCount = uppyInstances.length;

    const { rerender } = render(
      <ObjectUploader
        onGetUploadParameters={mockGetUploadParameters}
        onComplete={mockOnComplete}
        maxNumberOfFiles={1}
      >
        Upload File
      </ObjectUploader>
    );

    expect(uppyInstances.length).toBe(initialCount + 1);

    // Re-render with different props (but same key props)
    rerender(
      <ObjectUploader
        onGetUploadParameters={mockGetUploadParameters}
        onComplete={mockOnComplete}
        maxNumberOfFiles={2}
      >
        Upload File Changed
      </ObjectUploader>
    );

    // Should not create a new Uppy instance (still only 1)
    expect(uppyInstances.length).toBe(initialCount + 1);
  });

  it('should properly cleanup when component unmounts before initialization completes', () => {
    const { unmount } = render(
      <ObjectUploader
        onGetUploadParameters={mockGetUploadParameters}
        onComplete={mockOnComplete}
      >
        Upload File
      </ObjectUploader>
    );

    // Unmount immediately
    unmount();

    // Should not throw errors
    expect(() => unmount()).not.toThrow();
  });
});
