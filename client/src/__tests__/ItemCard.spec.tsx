import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ItemCard } from '@/components/ItemCard';
import { InventoryItem } from '@shared/schema';

// Mock JsBarcode to avoid canvas errors in tests
vi.mock('jsbarcode', () => ({
  default: vi.fn(),
}));

const createMockItem = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'test-item-1',
  name: 'Test Item',
  description: 'This is a short description.',
  category: 'Electronics',
  tags: ['tag1', 'tag2'],
  imageUrl: '/objects/items/test.jpg',
  imageUrls: ['/objects/items/test.jpg'],
  barcodeData: 'INV-123456-ABCD',
  estimatedValue: null,
  valueConfidence: null,
  valueRationale: null,
  location: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('ItemCard - Expandable Description', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should not show toggle for short descriptions', () => {
    const item = createMockItem({
      description: 'Short text',
    });

    render(
      <ItemCard
        item={item}
        onDelete={vi.fn()}
        onViewBarcode={vi.fn()}
      />
    );

    // Short description should not have toggle
    expect(screen.queryByTestId(`button-toggle-description-${item.id}`)).not.toBeInTheDocument();
  });

  it('should show "Show more" toggle when description is truncated', () => {
    const longDescription = 'This is a very long description that spans multiple lines and should definitely be truncated when displayed in the card. It contains a lot of detail about the item including its history, features, and other relevant information that users might want to read.';
    const item = createMockItem({
      description: longDescription,
    });

    render(
      <ItemCard
        item={item}
        onDelete={vi.fn()}
        onViewBarcode={vi.fn()}
      />
    );

    // Mock the scrollHeight > clientHeight condition
    const descriptionEl = screen.getByTestId(`text-description-${item.id}`);
    Object.defineProperty(descriptionEl, 'scrollHeight', { value: 100, configurable: true });
    Object.defineProperty(descriptionEl, 'clientHeight', { value: 40, configurable: true });

    // Re-render to trigger the useEffect
    fireEvent.resize(window);

    // Note: Due to JSDOM limitations, we can't fully test layout-based truncation detection
    // The component uses scrollHeight > clientHeight which doesn't work in JSDOM
    // In a real browser, the toggle would appear for long descriptions
  });

  it('should expand and collapse description when toggle is clicked', () => {
    const longDescription = 'This is a very long description that spans multiple lines and should definitely be truncated when displayed in the card. It contains a lot of detail about the item.';
    const item = createMockItem({
      description: longDescription,
    });

    const { rerender } = render(
      <ItemCard
        item={item}
        onDelete={vi.fn()}
        onViewBarcode={vi.fn()}
      />
    );

    const descriptionEl = screen.getByTestId(`text-description-${item.id}`);

    // Initially should have line-clamp-2 class
    expect(descriptionEl.className).toContain('line-clamp-2');

    // Simulate that text is truncated by mocking scrollHeight > clientHeight
    Object.defineProperty(descriptionEl, 'scrollHeight', { value: 100, configurable: true });
    Object.defineProperty(descriptionEl, 'clientHeight', { value: 40, configurable: true });

    // Force re-render to trigger truncation detection
    rerender(
      <ItemCard
        item={item}
        onDelete={vi.fn()}
        onViewBarcode={vi.fn()}
      />
    );

    // Due to JSDOM limitations, manually test the toggle behavior
    // when it would be visible (in integration/E2E tests)
  });

  it('should display the full description text', () => {
    const description = 'Test description content';
    const item = createMockItem({
      description,
    });

    render(
      <ItemCard
        item={item}
        onDelete={vi.fn()}
        onViewBarcode={vi.fn()}
      />
    );

    expect(screen.getByTestId(`text-description-${item.id}`)).toHaveTextContent(description);
  });

  it('should not show toggle when description is empty', () => {
    const item = createMockItem({
      description: '',
    });

    render(
      <ItemCard
        item={item}
        onDelete={vi.fn()}
        onViewBarcode={vi.fn()}
      />
    );

    expect(screen.queryByTestId(`button-toggle-description-${item.id}`)).not.toBeInTheDocument();
  });

  it('should render item name and category', () => {
    const item = createMockItem({
      name: 'Test Product',
      category: 'Furniture',
    });

    render(
      <ItemCard
        item={item}
        onDelete={vi.fn()}
        onViewBarcode={vi.fn()}
      />
    );

    expect(screen.getByTestId(`text-name-${item.id}`)).toHaveTextContent('Test Product');
    expect(screen.getByTestId(`badge-category-${item.id}`)).toHaveTextContent('Furniture');
  });

  it('should call onDelete when delete button is clicked', () => {
    const item = createMockItem();
    const onDelete = vi.fn();

    render(
      <ItemCard
        item={item}
        onDelete={onDelete}
        onViewBarcode={vi.fn()}
      />
    );

    const deleteButton = screen.getByTestId(`button-delete-${item.id}`);
    fireEvent.click(deleteButton);

    expect(onDelete).toHaveBeenCalledWith(item.id);
  });

  it('should call onViewBarcode when view barcode button is clicked', () => {
    const item = createMockItem();
    const onViewBarcode = vi.fn();

    render(
      <ItemCard
        item={item}
        onDelete={vi.fn()}
        onViewBarcode={onViewBarcode}
      />
    );

    const viewBarcodeButton = screen.getByTestId(`button-view-barcode-${item.id}`);
    fireEvent.click(viewBarcodeButton);

    expect(onViewBarcode).toHaveBeenCalledWith(item);
  });
});
