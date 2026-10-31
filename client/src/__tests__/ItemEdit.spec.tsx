import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ItemCard } from '@/components/ItemCard';
import { ItemEditDialog, fieldProvenance } from '@/components/ItemEditDialog';
import { queryClient } from '@/lib/queryClient';
import type { Identification, InventoryItem } from '@shared/schema';

vi.mock('jsbarcode', () => ({
  default: vi.fn(),
}));

const IDENTIFICATION: Identification = {
  confidence: 0.9,
  uncertainty: 'low',
  notes: null,
  alternatives: [],
  model: 'mock',
  identifiedAt: '2026-10-20T00:00:00.000Z',
  promptVersion: 'identify-v3',
};

function createItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-1',
    name: 'Cordless drill',
    description: 'Synthetic test item.',
    category: 'Tools',
    tags: ['drill'],
    imageUrl: '/objects/photos/a.jpg',
    imageUrls: ['/objects/photos/a.jpg'],
    barcodeData: 'INV-TEST',
    estimatedValue: null,
    valueConfidence: null,
    valueRationale: null,
    location: null,
    analysisMetadata: { model: 'mock' },
    identification: IDENTIFICATION,
    valuation: null,
    notes: null,
    userAssertions: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(init?.method === 'PATCH' ? createItem() : []), { status: 200 });
  }));
  return calls;
}

const patchBodies = (calls: Array<{ init?: RequestInit }>) =>
  calls.filter((call) => call.init?.method === 'PATCH').map((call) => JSON.parse(call.init!.body as string));

function renderWithClient(node: React.ReactNode) {
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe('item editing and confirmation', () => {
  beforeEach(() => queryClient.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('labels who supplied each value', () => {
    const item = createItem({
      location: 'Garage',
      userAssertions: {
        name: { source: 'user', assertedAt: '2026-10-21T00:00:00.000Z' },
        location: { source: 'batch_context', assertedAt: '2026-10-21T00:00:00.000Z' },
      },
    });

    expect(fieldProvenance(item, 'name')).toBe('user');
    expect(fieldProvenance(item, 'location')).toBe('batch_context');
    expect(fieldProvenance(item, 'category')).toBe('ai');
    expect(fieldProvenance(item, 'notes')).toBeNull();
    expect(fieldProvenance(createItem({ identification: null }), 'name')).toBeNull();
  });

  it('saves only the fields that changed', async () => {
    const calls = mockFetch();
    const onOpenChange = vi.fn();
    renderWithClient(<ItemEditDialog item={createItem()} open onOpenChange={onOpenChange} />);

    expect(screen.getByTestId('provenance-name')).toHaveTextContent('AI suggested');
    fireEvent.change(screen.getByTestId('input-edit-name'), { target: { value: "Dad's drill" } });
    fireEvent.change(screen.getByTestId('input-edit-tags'), { target: { value: 'Drill, cordless, drill' } });
    fireEvent.change(screen.getByTestId('input-edit-notes'), { target: { value: 'Lent to Sam' } });
    fireEvent.click(screen.getByTestId('button-save-edit'));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls[0].url).toBe('/api/items/item-1');
    expect(patchBodies(calls)).toEqual([
      { fields: { name: "Dad's drill", tags: ['drill', 'cordless'], notes: 'Lent to Sam' } },
    ]);
  });

  it('applies an AI suggestion with one click', async () => {
    const calls = mockFetch();
    const item = createItem({
      name: 'Thing',
      userAssertions: { name: { source: 'user', assertedAt: '2026-10-21T00:00:00.000Z' } },
      identification: { ...IDENTIFICATION, suggestions: { name: 'Cordless drill' } },
    });
    renderWithClient(<ItemEditDialog item={item} open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId('suggestion-name')).toHaveTextContent('AI suggests: Cordless drill');
    expect(screen.queryByTestId('suggestion-category')).toBeNull();
    fireEvent.click(screen.getByTestId('button-accept-name'));

    await waitFor(() => expect(patchBodies(calls)).toEqual([{ acceptSuggestions: ['name'] }]));
  });

  it('confirms unconfirmed AI details from the card in one click', async () => {
    const calls = mockFetch();
    const item = createItem({
      userAssertions: { category: { source: 'user', assertedAt: '2026-10-21T00:00:00.000Z' } },
    });
    renderWithClient(<ItemCard item={item} onDelete={vi.fn()} onViewBarcode={vi.fn()} />);

    fireEvent.click(screen.getByTestId('button-confirm-item-1'));

    await waitFor(() => expect(patchBodies(calls)).toEqual([{ confirm: ['name', 'description', 'tags'] }]));
  });

  it('shows no confirm button once everything is confirmed or the item was never identified', () => {
    const asserted = Object.fromEntries(
      ['name', 'description', 'category', 'tags'].map((field) => [field, { source: 'user', assertedAt: '2026-10-21T00:00:00.000Z' }])
    ) as InventoryItem['userAssertions'];
    renderWithClient(
      <>
        <ItemCard item={createItem({ id: 'done', userAssertions: asserted })} onDelete={vi.fn()} onViewBarcode={vi.fn()} />
        <ItemCard item={createItem({ id: 'manual', identification: null })} onDelete={vi.fn()} onViewBarcode={vi.fn()} />
      </>
    );

    expect(screen.queryByTestId('button-confirm-done')).toBeNull();
    expect(screen.getByTestId('icon-confirmed-done')).toBeInTheDocument();
    expect(screen.queryByTestId('button-confirm-manual')).toBeNull();
    expect(screen.getByTestId('button-edit-manual')).toBeInTheDocument();
  });
});
