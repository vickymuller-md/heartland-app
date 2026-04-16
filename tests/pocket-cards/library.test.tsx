import { describe, it, expect } from 'vitest';
import {
  MODULES,
  POCKET_CARDS,
  CARDS_BY_MODULE,
} from '@/lib/pocket-cards/constants';

// ==========================================================================
// CARD-01, CARD-03: Pocket Card Library -- Data Integrity
// 10 protocol figures organized by module
// Protocol v3.3, Figures 1-10
// ==========================================================================
describe('POCKET_CARDS constants', () => {
  it('defines exactly 10 pocket cards', () => {
    expect(POCKET_CARDS).toHaveLength(10);
  });

  it('each card has id, figureNumber (1-10), title, module, fileName, src, alt, width, height', () => {
    const nums = POCKET_CARDS.map((c) => c.figureNumber).sort((a, b) => a - b);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    POCKET_CARDS.forEach((card) => {
      expect(card.id).toBeTruthy();
      expect(card.title).toBeTruthy();
      expect(card.module).toBeDefined();
      expect(card.fileName).toBeTruthy();
      expect(card.src).toBeTruthy();
      expect(card.alt).toBeTruthy();
      expect(card.width).toBeGreaterThan(0);
      expect(card.height).toBeGreaterThan(0);
    });
  });

  it('card 1: "GDMT Optimization Quick Reference" -- Module 2', () => {
    const card = POCKET_CARDS.find((c) => c.figureNumber === 1);
    expect(card!.title).toBe('GDMT Optimization Quick Reference');
    expect(card!.module.number).toBe(2);
  });

  it('card 2: "Clinical Red Flags & Safety Gates" -- Module 3', () => {
    const card = POCKET_CARDS.find((c) => c.figureNumber === 2);
    expect(card!.title).toBe('Clinical Red Flags & Safety Gates');
    expect(card!.module.number).toBe(3);
  });

  it('card 3: "Patient Daily Diary" -- Module 5', () => {
    const card = POCKET_CARDS.find((c) => c.figureNumber === 3);
    expect(card!.title).toBe('Patient Daily Diary');
    expect(card!.module.number).toBe(5);
  });

  it('card 10: "Comorbidity Quick Reference" -- Module 6', () => {
    const card = POCKET_CARDS.find((c) => c.figureNumber === 10);
    expect(card!.title).toBe('Comorbidity Quick Reference');
    expect(card!.module.number).toBe(6);
  });

  it('all src paths start with "/figures/" and end with ".jpg"', () => {
    POCKET_CARDS.forEach((card) => {
      expect(card.src).toMatch(/^\/figures\/.*\.jpg$/);
    });
  });

  it('all alt texts are non-empty descriptive strings', () => {
    POCKET_CARDS.forEach((card) => {
      expect(card.alt.length).toBeGreaterThan(20);
    });
  });

  it('each card has a unique id', () => {
    const ids = POCKET_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(10);
  });
});

// ==========================================================================
// CARD-03: Module definitions for card grouping
// ==========================================================================
describe('MODULES constants', () => {
  it('defines 8 protocol modules with number, name, description', () => {
    expect(MODULES).toHaveLength(8);
    MODULES.forEach((mod) => {
      expect(mod.number).toBeGreaterThanOrEqual(1);
      expect(mod.number).toBeLessThanOrEqual(8);
      expect(mod.name.length).toBeGreaterThan(0);
      expect(mod.description.length).toBeGreaterThan(0);
    });
  });

  it('module numbers range from 1 to 8 in order', () => {
    const nums = MODULES.map((m) => m.number);
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('CARDS_BY_MODULE', () => {
  it('groups cards by their module number', () => {
    CARDS_BY_MODULE.forEach((group) => {
      group.cards.forEach((card) => {
        expect(card.module.number).toBe(group.module.number);
      });
    });
  });

  it('only includes modules that have at least one card', () => {
    CARDS_BY_MODULE.forEach((group) => {
      expect(group.cards.length).toBeGreaterThan(0);
    });
  });

  it('covers all 10 cards across all groups', () => {
    const total = CARDS_BY_MODULE.reduce(
      (sum, group) => sum + group.cards.length,
      0,
    );
    expect(total).toBe(10);
  });

  it('Module 2 (GDMT Optimization) has 2 cards: figures 1 and 5', () => {
    const gdmtGroup = CARDS_BY_MODULE.find((g) => g.module.number === 2);
    expect(gdmtGroup).toBeDefined();
    const figs = gdmtGroup!.cards.map((c) => c.figureNumber).sort();
    expect(figs).toEqual([1, 5]);
  });

  it('Module 5 (Remote Monitoring) has 2 cards: figures 3 and 4', () => {
    const rmGroup = CARDS_BY_MODULE.find((g) => g.module.number === 5);
    expect(rmGroup).toBeDefined();
    const figs = rmGroup!.cards.map((c) => c.figureNumber).sort();
    expect(figs).toEqual([3, 4]);
  });

  it('groups are sorted by module number', () => {
    const moduleNums = CARDS_BY_MODULE.map((g) => g.module.number);
    const sorted = [...moduleNums].sort((a, b) => a - b);
    expect(moduleNums).toEqual(sorted);
  });
});

// ==========================================================================
// Module affiliation per reference/README.md (all 10 cards)
// ==========================================================================
describe('Module affiliation per reference/README.md', () => {
  const expectedMapping: Record<number, number> = {
    1: 2, // GDMT -> Module 2
    2: 3, // Red Flags -> Module 3
    3: 5, // Patient Daily Diary -> Module 5
    4: 5, // Track Assignment -> Module 5
    5: 2, // Financial Navigation -> Module 2
    6: 1, // Risk Score Reference -> Module 1
    7: 8, // Implementation Tiers -> Module 8
    8: 7, // SBAR Handoff -> Module 7
    9: 4, // Teach-Back Checklist -> Module 4
    10: 6, // Comorbidity Quick Reference -> Module 6
  };

  Object.entries(expectedMapping).forEach(([fig, mod]) => {
    it(`Figure ${fig} -> Module ${mod}`, () => {
      const card = POCKET_CARDS.find((c) => c.figureNumber === Number(fig));
      expect(card).toBeDefined();
      expect(card!.module.number).toBe(mod);
    });
  });
});
