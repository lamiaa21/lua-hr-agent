import type { CountryCode } from './countries.js';

/**
 * Mock leave entitlement rules modelled on public labour-law summaries for
 * KSA, UAE, Egypt, and Jordan. This is a demo, not legal advice — do not
 * present these figures as authoritative.
 *
 * Rules are data, not conditionals, so a new tier or country is a table
 * edit, not a code change.
 */

export interface AnnualLeaveTier {
  /** Tier applies once the employee has this many completed months of service. */
  minMonthsOfService: number;
  /** Flat annual entitlement in days for this tier. Omit if accrualDaysPerMonth is used instead. */
  days?: number;
  /** If set, entitlement = accrualDaysPerMonth * completed months of service (used for UAE's 6-12 month ramp). */
  accrualDaysPerMonth?: number;
  /** This tier also applies once the employee reaches this age, regardless of tenure (used for Egypt's 50+ rule). */
  orMinAge?: number;
  note: string;
}

export interface SickLeaveTier {
  days: number;
  payPercent: number;
}

export interface CountryEntitlements {
  country: CountryCode;
  /** Ordered ascending by minMonthsOfService — the resolver picks the last tier the employee qualifies for. */
  annualLeave: AnnualLeaveTier[];
  sickLeave: SickLeaveTier[];
  emergencyLeaveDaysPerYear: number;
  emergencyMaxConsecutiveDays?: number;
}

export const ENTITLEMENTS: Record<CountryCode, CountryEntitlements> = {
  SA: {
    country: 'SA',
    annualLeave: [
      { minMonthsOfService: 0, days: 21, note: 'KSA: base entitlement under 5 years of service' },
      { minMonthsOfService: 60, days: 30, note: 'KSA: 30 days after 5 years of service (>5y threshold)' },
    ],
    sickLeave: [
      { days: 30, payPercent: 100 },
      { days: 60, payPercent: 75 },
      { days: 30, payPercent: 0 },
    ],
    emergencyLeaveDaysPerYear: 5,
  },
  AE: {
    country: 'AE',
    annualLeave: [
      { minMonthsOfService: 0, days: 0, note: 'UAE: no annual leave entitlement before 6 months of service' },
      { minMonthsOfService: 6, accrualDaysPerMonth: 2, note: 'UAE: 2 days per month of service (6-12 month ramp)' },
      { minMonthsOfService: 12, days: 30, note: 'UAE: 30 calendar days/year after 1 year of service' },
    ],
    sickLeave: [
      { days: 15, payPercent: 100 },
      { days: 30, payPercent: 50 },
    ],
    emergencyLeaveDaysPerYear: 5,
  },
  EG: {
    country: 'EG',
    annualLeave: [
      { minMonthsOfService: 0, days: 21, note: 'Egypt: base entitlement under 10 years of service, under 50' },
      { minMonthsOfService: 120, days: 30, orMinAge: 50, note: 'Egypt: 30 days after 10 years of service, or age 50+' },
    ],
    sickLeave: [
      // Mock approximation of Egypt's social-insurance sick pay schedule.
      { days: 90, payPercent: 75 },
      { days: 90, payPercent: 85 },
    ],
    emergencyLeaveDaysPerYear: 6,
    emergencyMaxConsecutiveDays: 2,
  },
  JO: {
    country: 'JO',
    annualLeave: [
      { minMonthsOfService: 0, days: 14, note: 'Jordan: base entitlement under 5 years with same employer' },
      { minMonthsOfService: 60, days: 21, note: 'Jordan: 21 days after 5 years with same employer' },
    ],
    sickLeave: [{ days: 14, payPercent: 100 }],
    emergencyLeaveDaysPerYear: 3,
  },
};

/** Completed whole months between two ISO dates. */
export function monthsOfService(hireDate: string, asOfDate: string = new Date().toISOString()): number {
  const hire = new Date(hireDate);
  const asOf = new Date(asOfDate);
  let months = (asOf.getFullYear() - hire.getFullYear()) * 12 + (asOf.getMonth() - hire.getMonth());
  if (asOf.getDate() < hire.getDate()) months -= 1;
  return Math.max(0, months);
}

/** Years of service, fractional (for gratuity pro-rating). */
export function yearsOfService(hireDate: string, asOfDate: string = new Date().toISOString()): number {
  const hire = new Date(hireDate);
  const asOf = new Date(asOfDate);
  return Math.max(0, (asOf.getTime() - hire.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

export interface AnnualLeaveResolution {
  days: number;
  policyNote: string;
}

/** Resolves the annual leave tier a country + tenure + age qualify for. */
export function resolveAnnualLeave(country: CountryCode, hireDate: string, age?: number): AnnualLeaveResolution {
  const months = monthsOfService(hireDate);
  const tiers = ENTITLEMENTS[country].annualLeave;

  let winner = tiers[0];
  for (const tier of tiers) {
    const meetsTenure = months >= tier.minMonthsOfService;
    const meetsAge = tier.orMinAge !== undefined && age !== undefined && age >= tier.orMinAge;
    if (meetsTenure || meetsAge) winner = tier;
  }

  const days = winner.accrualDaysPerMonth !== undefined ? winner.accrualDaysPerMonth * months : winner.days ?? 0;
  return { days, policyNote: `${winner.note} (${(months / 12).toFixed(1)}y service)` };
}

export function resolveSickLeave(country: CountryCode): AnnualLeaveResolution {
  const tiers = ENTITLEMENTS[country].sickLeave;
  const days = tiers.reduce((sum, tier) => sum + tier.days, 0);
  const note = tiers.map((tier) => `${tier.days}d @ ${tier.payPercent}% pay`).join(', ');
  return { days, policyNote: `${country}: ${note} (${days} total days/year across pay tiers)` };
}

export function resolveEmergencyLeave(country: CountryCode): AnnualLeaveResolution {
  const rules = ENTITLEMENTS[country];
  const consecutive = rules.emergencyMaxConsecutiveDays
    ? `, max ${rules.emergencyMaxConsecutiveDays} consecutive days`
    : '';
  return {
    days: rules.emergencyLeaveDaysPerYear,
    policyNote: `${country}: ${rules.emergencyLeaveDaysPerYear} emergency days/year${consecutive}`,
  };
}

/** Age in whole years as of today, from an ISO date of birth. */
export function ageFromDateOfBirth(dateOfBirth: string, asOfDate: string = new Date().toISOString()): number {
  const dob = new Date(dateOfBirth);
  const asOf = new Date(asOfDate);
  let age = asOf.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    asOf.getMonth() < dob.getMonth() || (asOf.getMonth() === dob.getMonth() && asOf.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}
