import { describe, expect, it } from 'vitest';
import { trainingPhaseNote } from './insights';

describe('trainingPhaseNote', () => {
  it('flags "optimum pre-race" when RHR is mildly up and HRV is still strong', () => {
    expect(trainingPhaseNote(4, 0.8, 0.7)).toMatch(/optimum pre-race/);
    expect(trainingPhaseNote(1, 1.2, 0.5)).toMatch(/optimum pre-race/);
  });

  it('flags "not coping well" when RHR is mildly up but HRV has slipped', () => {
    expect(trainingPhaseNote(4, 0.2, 0.7)).toMatch(/may not be coping well/);
  });

  it('flags "coping well during training blocks" when RHR is calm and HRV is strong', () => {
    expect(trainingPhaseNote(4, 0.8, -0.7)).toMatch(/coping well/);
  });

  it('gives no note when RHR is near zero (neither activated nor calm)', () => {
    expect(trainingPhaseNote(4, 2, 0)).toBeNull();
  });

  it('gives no note when RHR is calm but HRV has not recovered', () => {
    expect(trainingPhaseNote(4, 0.1, -0.7)).toBeNull();
  });

  it('gives no note once RHR is past the hatched band, even if still classified Normal', () => {
    expect(trainingPhaseNote(4, 2, 1.6)).toBeNull();
  });

  it('only refines HIT (1) and Normal (4); every other code is left alone', () => {
    for (const code of [2, 3, 5, 6, 7] as const) {
      expect(trainingPhaseNote(code, 2, 0.5)).toBeNull();
    }
  });

  it('gives no note when either z-score is NaN', () => {
    expect(trainingPhaseNote(4, NaN, 0.5)).toBeNull();
    expect(trainingPhaseNote(4, 0.5, NaN)).toBeNull();
  });
});
