import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ItemCard } from '@/components/ItemCard';
import { Dashboard } from '@/components/Dashboard';
import type { Identification, InventoryItem, Valuation } from '@shared/schema';

vi.mock('jsbarcode', () => ({
  default: vi.fn(),
}));

const IDENTIFICATION: Identification = {
  confidence: 0.92,
  uncertainty: 'low',
  notes: null,
  alternatives: [],
  model: 'gpt-4o-mini',
  identifiedAt: '2026-10-20T00:00:00.000Z',
  promptVersion: 'identify-v1',
};

function createValuation(overrides: Partial<Valuation> = {}): Valuation {
  return {
    status: 'estimated',
    marketability: 'marketable',
    marketabilityReason: 'Branded cordless drills have steady used demand.',
    currency: 'USD',
    low: '40.00',
    likely: '55.00',
    high: '70.00',
    confidence: 'medium',
    rationale: 'Used drills of this type typically sell in this range.',
    missingInformation: [],
    evidence: {
      basis: 'model_judgment',
      note: 'AI judgment from the photos and identification. No marketplace or sales data was retrieved.',
    },
    basedOn: { name: 'Cordless drill', category: 'Tools', identifiedAt: IDENTIFICATION.identifiedAt },
    model: 'gpt-4o',
    evaluatedAt: '2026-10-21T00:00:00.000Z',
    promptVersion: 'valuation-v1',
    staleAt: null,
    staleReason: null,
    ...overrides,
  };
}

let nextId = 0;
function createItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  nextId += 1;
  return {
    id: `item-${nextId}`,
    name: 'Cordless drill',
    description: 'Synthetic test item.',
    category: 'Tools',
    tags: [],
    imageUrl: '/objects/items/test.jpg',
    imageUrls: ['/objects/items/test.jpg'],
    barcodeData: 'INV-TEST',
    estimatedValue: null,
    valueConfidence: null,
    valueRationale: null,
    location: null,
    analysisMetadata: { model: 'gpt-4o-mini' },
    identification: IDENTIFICATION,
    valuation: null,
    notes: null,
    userAssertions: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderCard(item: InventoryItem, handlers: Partial<Parameters<typeof ItemCard>[0]> = {}) {
  render(
    <ItemCard
      item={item}
      onDelete={vi.fn()}
      onViewBarcode={vi.fn()}
      onIdentify={vi.fn()}
      onEstimateValue={vi.fn()}
      {...handlers}
    />
  );
  return within(screen.getByTestId(`card-item-${item.id}`));
}

afterEach(() => {
  cleanup();
});

describe('ItemCard value states', () => {
  it('shows "not evaluated" instead of a price when no valuation exists', () => {
    const item = createItem();
    const card = renderCard(item);

    expect(card.getByTestId(`text-value-status-${item.id}`)).toHaveTextContent('Value not evaluated');
    expect(card.queryByTestId(`text-value-${item.id}`)).toBeNull();
    expect(card.queryByText(/\$/)).toBeNull();
  });

  it('shows a current estimate as a range labelled as AI judgment', () => {
    const item = createItem({ valuation: createValuation() });
    const card = renderCard(item);

    expect(card.getByTestId(`text-value-${item.id}`)).toHaveTextContent('$40.00 – $70.00');
    expect(card.getByText('likely $55.00')).toBeInTheDocument();
    expect(card.getByTestId(`badge-confidence-${item.id}`)).toHaveTextContent('medium confidence');
    expect(card.getByTestId(`badge-evidence-${item.id}`)).toHaveTextContent('AI judgment');
  });

  it('marks a stale estimate and says it is not counted', () => {
    const item = createItem({
      valuation: createValuation({ staleAt: '2026-10-22T00:00:00.000Z', staleReason: 'reidentified' }),
      notes: null,
      userAssertions: null,
    });
    const card = renderCard(item);

    expect(card.getByTestId(`text-value-${item.id}`)).toHaveClass('line-through');
    expect(card.getByTestId(`text-stale-${item.id}`)).toHaveTextContent('Not counted in totals');
  });

  it('shows a nonmarketable river rock without any price', () => {
    const item = createItem({
      name: 'River rock',
      valuation: createValuation({
        status: 'nonmarketable',
        marketability: 'nonmarketable',
        marketabilityReason: 'Ordinary river rocks are not bought secondhand.',
        low: null,
        likely: null,
        high: null,
        confidence: null,
      }),
    });
    const card = renderCard(item);

    expect(card.getByTestId(`badge-value-status-${item.id}`)).toHaveTextContent('No resale market');
    expect(card.getByText('Ordinary river rocks are not bought secondhand.')).toBeInTheDocument();
    expect(card.queryByText(/\$/)).toBeNull();
  });

  it('explains what is missing when a value cannot be established', () => {
    const item = createItem({
      valuation: createValuation({
        status: 'insufficient_information',
        marketability: 'uncertain',
        low: null,
        likely: null,
        high: null,
        confidence: null,
        missingInformation: ["maker's mark", 'photo of the base'],
      }),
    });
    const card = renderCard(item);

    expect(card.getByTestId(`badge-value-status-${item.id}`)).toHaveTextContent("Value can't be established");
    expect(card.getByTestId(`text-missing-info-${item.id}`)).toHaveTextContent("maker's mark, photo of the base");
  });

  it('shows a legacy amount with its provenance, not as a current estimate', () => {
    const item = createItem({
      identification: null,
      analysisMetadata: { model: 'openai' },
      estimatedValue: '125.00',
      valueConfidence: 'medium',
      valueRationale: 'Based on similar vintage cameras',
    });
    const card = renderCard(item);

    expect(card.getByTestId(`text-value-status-${item.id}`)).toHaveTextContent('Value not evaluated');
    expect(card.getByTestId(`text-legacy-value-${item.id}`)).toHaveTextContent(
      'Legacy estimate $125.00 from the old combined analysis (unverified, not counted in totals)'
    );
    expect(card.queryByTestId(`text-value-${item.id}`)).toBeNull();
  });

  it('hides a legacy 0.00 placeholder except in details', () => {
    const item = createItem({ estimatedValue: '0.00', valueConfidence: null });
    const card = renderCard(item);

    expect(card.queryByTestId(`text-legacy-value-${item.id}`)).toBeNull();
    expect(card.queryByText(/\$0\.00/)).toBeNull();

    fireEvent.click(card.getByTestId(`button-toggle-ai-details-${item.id}`));
    expect(card.getByTestId(`ai-details-${item.id}`)).toHaveTextContent('not a valuation');
  });

  it('hides a legacy 0.00 recorded with confidence, and explains it in details', () => {
    const item = createItem({ estimatedValue: '0.00', valueConfidence: 'low', valueRationale: 'Common rock' });
    const card = renderCard(item);

    expect(card.queryByTestId(`text-legacy-value-${item.id}`)).toBeNull();
    expect(card.queryByText(/\$0\.00/)).toBeNull();

    fireEvent.click(card.getByTestId(`button-toggle-ai-details-${item.id}`));
    const details = card.getByTestId(`ai-details-${item.id}`);
    expect(details).toHaveTextContent('Recorded as $0.00 (low confidence) by the old combined analysis');
    expect(details).toHaveTextContent('ambiguous');
    expect(details).not.toHaveTextContent('Common rock');
  });

  it('reveals evidence and identification uncertainty in AI details on tap', () => {
    const item = createItem({
      identification: {
        ...IDENTIFICATION,
        confidence: 0.3,
        uncertainty: 'high',
        notes: "Maker's mark not visible.",
        alternatives: ['Butter churn base'],
      },
      valuation: createValuation(),
      notes: null,
      userAssertions: null,
    });
    const card = renderCard(item);

    expect(card.getByTestId(`badge-id-uncertainty-${item.id}`)).toHaveTextContent('Uncertain ID');
    expect(card.queryByTestId(`ai-details-${item.id}`)).toBeNull();

    fireEvent.click(card.getByTestId(`button-toggle-ai-details-${item.id}`));

    const details = card.getByTestId(`ai-details-${item.id}`);
    expect(details).toHaveTextContent('High uncertainty');
    expect(details).toHaveTextContent('Could also be: Butter churn base');
    expect(card.getByTestId(`text-evidence-note-${item.id}`)).toHaveTextContent(
      'No marketplace or sales data was retrieved'
    );
  });
});

describe('ItemCard AI actions', () => {
  it('identifies an unidentified item directly and blocks estimating it', () => {
    const onIdentify = vi.fn();
    const item = createItem({ identification: null, analysisMetadata: { model: 'none' } });
    const card = renderCard(item, { onIdentify });

    expect(card.getByTestId(`badge-unidentified-${item.id}`)).toBeInTheDocument();
    expect(card.getByTestId(`button-estimate-${item.id}`)).toBeDisabled();

    fireEvent.click(card.getByTestId(`button-identify-${item.id}`));
    expect(onIdentify).toHaveBeenCalledWith(item.id);
  });

  it('asks for confirmation before re-identifying and mentions the stale estimate', () => {
    const onIdentify = vi.fn();
    const item = createItem({ valuation: createValuation() });
    const card = renderCard(item, { onIdentify });

    fireEvent.click(card.getByTestId(`button-identify-${item.id}`));
    expect(onIdentify).not.toHaveBeenCalled();
    expect(screen.getByText(/marked stale until you re-estimate/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`button-cancel-reidentify-${item.id}`));
    expect(onIdentify).not.toHaveBeenCalled();

    fireEvent.click(card.getByTestId(`button-identify-${item.id}`));
    fireEvent.click(screen.getByTestId(`button-confirm-reidentify-${item.id}`));
    expect(onIdentify).toHaveBeenCalledWith(item.id);
  });

  it('runs Estimate Value only when its button is clicked', () => {
    const onEstimateValue = vi.fn();
    const item = createItem();
    const card = renderCard(item, { onEstimateValue });

    expect(onEstimateValue).not.toHaveBeenCalled();
    expect(card.getByTestId(`button-estimate-${item.id}`)).toHaveTextContent('Estimate Value');

    fireEvent.click(card.getByTestId(`button-estimate-${item.id}`));
    expect(onEstimateValue).toHaveBeenCalledWith(item.id);
  });

  it('labels the action Re-estimate once a valuation exists', () => {
    const item = createItem({ valuation: createValuation() });
    const card = renderCard(item);

    expect(card.getByTestId(`button-estimate-${item.id}`)).toHaveTextContent('Re-estimate');
  });

  it('disables both AI actions while one is running', () => {
    const item = createItem();
    const card = renderCard(item, { isEstimating: true });

    expect(card.getByTestId(`button-identify-${item.id}`)).toBeDisabled();
    expect(card.getByTestId(`button-estimate-${item.id}`)).toBeDisabled();
  });
});

describe('Dashboard totals (valuation-v4)', () => {
  const itemValuation = (likely: string, extra: Partial<Valuation> = {}) =>
    createValuation({ likely, scope: 'item', assumptions: ['visible_condition_only'], ...extra });
  const categoryValuation = (likely: string) =>
    createValuation({ likely, scope: 'category', confidence: 'low', assumptions: ['unattributed', 'visible_condition_only'] });

  it('totals item estimates and category baselines separately, and combines only those', () => {
    render(
      <Dashboard
        items={[
          createItem({ valuation: itemValuation('55.00') }),
          createItem({ valuation: itemValuation('20.00') }),
          createItem({ valuation: categoryValuation('6.00') }),
          createItem({ valuation: createValuation({ likely: '40.00' }) }), // basis not recorded
          createItem({ valuation: itemValuation('900.00', { staleAt: '2026-10-22T00:00:00.000Z' }) }),
          createItem({ estimatedValue: '300.00', valueConfidence: 'high' }),
          createItem(),
        ]}
      />
    );

    expect(screen.getByTestId('stat-item-total')).toHaveTextContent('$75.00');
    expect(screen.getByTestId('stat-item-total-detail')).toHaveTextContent('2 items');
    expect(screen.getByTestId('stat-category-total')).toHaveTextContent('$6.00');
    expect(screen.getByTestId('stat-category-total-detail')).toHaveTextContent('1 item · typical unattributed');
    expect(screen.getByTestId('stat-combined-total')).toHaveTextContent('$81.00');
    expect(screen.getByTestId('stat-combined-total-detail')).toHaveTextContent(
      '3 items · item + category estimates · 1 with basis not recorded, 1 stale, 1 legacy not counted'
    );
  });

  it('shows dashes instead of $0.00 when nothing qualifies, including unrecorded-basis estimates', () => {
    render(
      <Dashboard
        items={[
          createItem(),
          createItem({ estimatedValue: '0.00' }),
          createItem({ valuation: createValuation({ likely: '40.00' }) }),
        ]}
      />
    );

    expect(screen.getByTestId('stat-item-total')).toHaveTextContent('—');
    expect(screen.getByTestId('stat-category-total')).toHaveTextContent('—');
    expect(screen.getByTestId('stat-combined-total')).toHaveTextContent('—');
    expect(screen.getByTestId('stat-combined-total-detail')).toHaveTextContent('1 with basis not recorded');
  });
});

describe('ItemCard valuation scope (valuation-v4)', () => {
  it('labels an item estimate and explains untested functionality', () => {
    const item = createItem({
      valuation: createValuation({ scope: 'item', confidence: 'low', assumptions: ['as_is_untested', 'visible_condition_only'] }),
      notes: null,
      userAssertions: null,
    });
    const card = renderCard(item);

    expect(card.getByTestId(`badge-scope-${item.id}`)).toHaveTextContent('Item estimate');
    expect(card.getByTestId(`list-assumptions-${item.id}`)).toHaveTextContent(
      'Assumes: Functionality untested (unknown, not known to be faulty)'
    );
    expect(card.getByTestId(`list-assumptions-${item.id}`)).not.toHaveTextContent('photos only');
    expect(card.getByTestId(`text-indicative-note-${item.id}`)).toHaveTextContent('Not an appraisal');
  });

  it('labels a category baseline as a typical unattributed item', () => {
    const item = createItem({
      name: 'Ceramic Mug',
      valuation: createValuation({ scope: 'category', confidence: 'low', assumptions: ['unattributed', 'visible_condition_only'] }),
      notes: null,
      userAssertions: null,
    });
    const card = renderCard(item);

    expect(card.getByTestId(`badge-scope-${item.id}`)).toHaveTextContent('Category baseline');
    expect(card.getByTestId(`text-category-baseline-${item.id}`)).toHaveTextContent('Typical used ceramic mug, maker unknown');
    expect(card.getByTestId(`list-assumptions-${item.id}`)).toHaveTextContent('excludes any maker, collectible, authenticity, or provenance premium');
  });

  it('labels an earlier estimate as basis not recorded without reclassifying it', () => {
    const item = createItem({ valuation: createValuation() });
    const card = renderCard(item);

    expect(card.getByTestId(`badge-scope-${item.id}`)).toHaveTextContent('Basis not recorded');
    expect(card.queryByTestId(`text-category-baseline-${item.id}`)).toBeNull();
    expect(card.queryByTestId(`list-assumptions-${item.id}`)).toBeNull();
    expect(card.getByTestId(`text-indicative-note-${item.id}`)).toBeInTheDocument();
  });
});

