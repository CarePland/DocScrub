/**
 * percentDisplay.ts -- one display rule for percentage figures that are
 * claims, not raw measurements. A rounded endpoint can lie: 99.55% rendered
 * as bare "100%" reads as complete, and 0.4% rendered as bare "0%" reads as
 * absent. The tilde marks those rounded endpoints as approximate while
 * leaving ordinary middle values quiet.
 */

export function formatPercentFigure(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "0%";
  const bounded = Math.min(100, Math.max(0, value));
  const precision = Math.max(0, Math.trunc(decimals));
  const roundedText = bounded.toFixed(precision);
  const rounded = Number(roundedText);
  const approximateEndpoint = (rounded === 100 && bounded < 100) || (rounded === 0 && bounded > 0);
  return `${approximateEndpoint ? "~" : ""}${roundedText}%`;
}

export function isRestingFigure(value: number): boolean {
  return !Number.isFinite(value) || value === 0;
}
