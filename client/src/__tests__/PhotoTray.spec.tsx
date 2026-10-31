import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PhotoTray } from '@/components/PhotoTray';
import { queryClient } from '@/lib/queryClient';

function photo(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    batchId: 'batch-1',
    objectPath: `/objects/photos/${id}.jpg`,
    sha256: 'f'.repeat(64),
    bytes: 100,
    mimeType: 'image/jpeg',
    originalFilename: `${id}.jpg`,
    source: 'batch_upload',
    createdAt: '2026-10-25T00:00:00.000Z',
    itemIds: [],
    sessionId: 'session-1',
    sessionTitle: 'Garage sweep',
    context: { location: 'Garage', container: 'Blue bin' },
    ...extra,
  };
}

function mockFetch(unsorted: unknown[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'item-1', name: 'Untitled Item', _aiWarning: null }), { status: 201 });
    }
    return new Response(JSON.stringify(url.includes('unassigned') ? unsorted : unsorted), { status: 200 });
  }));
  return calls;
}

function renderTray() {
  return render(
    <QueryClientProvider client={queryClient}>
      <PhotoTray />
    </QueryClientProvider>
  );
}

describe('PhotoTray', () => {
  beforeEach(() => queryClient.clear());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('stays out of the way when nothing is unsorted', async () => {
    mockFetch([]);
    renderTray();

    await waitFor(() => expect(queryClient.getQueryData(['/api/photos?unassigned=true'])).toEqual([]));
    expect(screen.queryByTestId('section-photo-tray')).toBeNull();
  });

  it('shows unsorted photos with their batch context', async () => {
    mockFetch([photo('a'), photo('b')]);
    renderTray();

    expect(await screen.findByTestId('photo-a')).toBeInTheDocument();
    expect(screen.getByTestId('text-tray-count')).toHaveTextContent('(2)');
    expect(screen.getAllByText('Garage › Blue bin')).toHaveLength(2);
  });

  it('creates one item from the selected photos', async () => {
    const calls = mockFetch([photo('a'), photo('b'), photo('c')]);
    renderTray();

    fireEvent.click(await screen.findByTestId('photo-a'));
    fireEvent.click(screen.getByTestId('photo-c'));
    fireEvent.change(screen.getByTestId('input-new-item-name'), { target: { value: 'Socket set' } });
    fireEvent.click(screen.getByTestId('button-create-from-photos'));

    await waitFor(() => expect(calls.some((call) => call.init?.method === 'POST')).toBe(true));
    const post = calls.find((call) => call.init?.method === 'POST')!;
    expect(post.url).toBe('/api/items/from-photos');
    expect(JSON.parse(post.init!.body as string)).toEqual({ photoIds: ['a', 'c'], name: 'Socket set', identify: false });
  });
});
