export function mean(values: number[]): number {
  const valid = values.filter((v) => !Number.isNaN(v));
  if (valid.length === 0) return NaN;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

/** Population standard deviation (divides by N, matching MATLAB's std(x,1,...)). */
export function populationStd(values: number[]): number {
  const valid = values.filter((v) => !Number.isNaN(v));
  if (valid.length === 0) return NaN;
  const m = mean(valid);
  const variance = valid.reduce((sum, v) => sum + (v - m) ** 2, 0) / valid.length;
  return Math.sqrt(variance);
}
