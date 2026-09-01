/**
 * KSA end-of-service gratuity, modelled on public labour-law summaries —
 * not legal advice. Modelled for KSA only; other countries aren't covered
 * in this build (see README).
 *
 * - Half a month's wage per year for the first 5 years, a full month's wage
 *   per year beyond that, partial years pro-rated.
 * - Resignation scales the award down by tenure; termination pays it in full.
 */

export type SeparationType = 'resignation' | 'termination';

export interface GratuityLineItem {
  label: string;
  amount: number;
}

export interface GratuityResult {
  totalAmount: number;
  yearsOfService: number;
  breakdown: GratuityLineItem[];
  ruleCitations: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateKsaGratuity(
  monthlyWage: number,
  yearsOfService: number,
  separationType: SeparationType,
): GratuityResult {
  const breakdown: GratuityLineItem[] = [];
  const ruleCitations = [
    'KSA: half a month\'s wage per year for the first 5 years of service',
    'KSA: a full month\'s wage per year of service beyond 5 years',
  ];

  const first5Years = Math.min(yearsOfService, 5);
  const beyond5Years = Math.max(0, yearsOfService - 5);

  const first5Amount = round2(first5Years * 0.5 * monthlyWage);
  breakdown.push({
    label: `${first5Years.toFixed(2)} year(s) × 0.5 month's wage (first 5 years of service)`,
    amount: first5Amount,
  });

  let beyond5Amount = 0;
  if (beyond5Years > 0) {
    beyond5Amount = round2(beyond5Years * monthlyWage);
    breakdown.push({
      label: `${beyond5Years.toFixed(2)} year(s) × 1 month's wage (service beyond 5 years)`,
      amount: beyond5Amount,
    });
  }

  const fullAward = first5Amount + beyond5Amount;

  let multiplier = 1;
  let multiplierNote = 'KSA: termination/end of contract pays the full award';
  if (separationType === 'resignation') {
    if (yearsOfService < 2) {
      multiplier = 0;
      multiplierNote = 'KSA: resignation under 2 years of service — no entitlement';
    } else if (yearsOfService < 5) {
      multiplier = 1 / 3;
      multiplierNote = 'KSA: resignation with 2-5 years of service — one third of the award';
    } else if (yearsOfService < 10) {
      multiplier = 2 / 3;
      multiplierNote = 'KSA: resignation with 5-10 years of service — two thirds of the award';
    } else {
      multiplier = 1;
      multiplierNote = 'KSA: resignation with 10+ years of service — full award';
    }
  }
  ruleCitations.push(multiplierNote);

  const totalAmount = round2(fullAward * multiplier);
  breakdown.push({
    label: multiplier === 1 ? multiplierNote : `${multiplierNote} (× ${round2(multiplier)})`,
    amount: totalAmount,
  });

  return { totalAmount, yearsOfService: round2(yearsOfService), breakdown, ruleCitations };
}
