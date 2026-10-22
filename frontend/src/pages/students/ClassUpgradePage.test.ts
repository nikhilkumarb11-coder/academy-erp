import { describe, expect, it } from 'vitest';
import { suggestNextClass } from './ClassUpgradePage';

describe('suggestNextClass', () => {
  it('bumps numbered and Class N labels', () => {
    expect(suggestNextClass('5')).toBe('6');
    expect(suggestNextClass('Class 5')).toBe('Class 6');
    expect(suggestNextClass('5th')).toBe('6th');
  });

  it('follows the nursery ladder', () => {
    expect(suggestNextClass('LKG')).toBe('UKG');
    expect(suggestNextClass('UKG')).toBe('1');
  });

  it('leaves blank alone', () => {
    expect(suggestNextClass('')).toBe('');
  });
});
