export type CountryCode = 'SA' | 'AE' | 'EG' | 'JO';

export interface CountryMeta {
  code: CountryCode;
  nameEn: string;
  nameAr: string;
  currency: string;
  /**
   * Mock policy modelled on public labour-law summaries, not legal advice.
   * Probation length and whether annual leave accrues during it.
   */
  probationDays: number;
  probationAccruesAnnualLeave: boolean;
}

export const COUNTRIES: Record<CountryCode, CountryMeta> = {
  SA: {
    code: 'SA',
    nameEn: 'Saudi Arabia',
    nameAr: 'المملكة العربية السعودية',
    currency: 'SAR',
    probationDays: 90,
    probationAccruesAnnualLeave: false,
  },
  AE: {
    code: 'AE',
    nameEn: 'United Arab Emirates',
    nameAr: 'الإمارات العربية المتحدة',
    currency: 'AED',
    probationDays: 180,
    probationAccruesAnnualLeave: false,
  },
  EG: {
    code: 'EG',
    nameEn: 'Egypt',
    nameAr: 'مصر',
    currency: 'EGP',
    probationDays: 90,
    probationAccruesAnnualLeave: false,
  },
  JO: {
    code: 'JO',
    nameEn: 'Jordan',
    nameAr: 'الأردن',
    currency: 'JOD',
    probationDays: 90,
    probationAccruesAnnualLeave: false,
  },
};
