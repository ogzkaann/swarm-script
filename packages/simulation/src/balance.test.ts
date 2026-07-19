import { describe, expect, it } from 'vitest';
import { runBalanceReport } from './balance';

describe('deterministic balance harness', () => {
  it('reports repeatable multi-seed outcomes and real ability/build metrics', () => {
    const seeds = Array.from({ length: 20 }, (_, index) => 43090 + index);
    const left = runBalanceReport(seeds);
    const right = runBalanceReport(seeds);
    if (process.env.BALANCE_REPORT === '1') console.info(JSON.stringify(left, null, 2));
    expect(left).toEqual(right);
    expect(left.averageDuration).toBeGreaterThan(0);
    expect(Object.values(left.averageDamage).every((damage) => damage > 0)).toBe(true);
    expect(Object.values(left.abilityUsage).some((uses) => uses > 0)).toBe(true);
    expect(Object.values(left.upgradePicks).reduce((sum, picks) => sum + picks, 0)).toBeGreaterThan(
      0,
    );
  });
});
