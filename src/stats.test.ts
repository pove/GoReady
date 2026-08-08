import { describe, expect, it } from 'vitest';
import { mean, populationStd } from './stats';

describe('mean', () => {
  it('averages a plain array', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('ignores NaN values', () => {
    expect(mean([10, NaN, 20, NaN])).toBe(15);
  });

  it('returns NaN when every value is NaN', () => {
    expect(mean([NaN, NaN])).toBeNaN();
  });

  it('returns NaN for an empty array', () => {
    expect(mean([])).toBeNaN();
  });
});

describe('populationStd', () => {
  it('matches the population (divide-by-N) formula, not sample std', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9]: mean 5, population variance 4, std 2.
    expect(populationStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
  });

  it('is zero for a constant array', () => {
    expect(populationStd([7, 7, 7])).toBe(0);
  });

  it('ignores NaN values when computing the mean and spread', () => {
    expect(populationStd([2, 4, 4, 4, 5, 5, 7, 9, NaN])).toBeCloseTo(2, 10);
  });

  it('returns NaN for an empty array', () => {
    expect(populationStd([])).toBeNaN();
  });
});
