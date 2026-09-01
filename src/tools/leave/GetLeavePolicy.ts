import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { COUNTRIES, type CountryCode } from '../../config/countries.js';
import { ENTITLEMENTS } from '../../config/entitlements.js';

const COUNTRY_CODES = Object.keys(COUNTRIES) as [CountryCode, ...CountryCode[]];

export class GetLeavePolicy implements LuaTool {
  name = 'get_leave_policy';
  description = 'Look up the general leave entitlement rules and probation policy for a country, independent of any one employee.';
  inputSchema = z.object({
    country: z.enum(COUNTRY_CODES).describe('ISO-ish country code: SA (KSA), AE (UAE), EG (Egypt), or JO (Jordan).'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const country = COUNTRIES[input.country];
    const rules = ENTITLEMENTS[input.country];
    return {
      country: country.nameEn,
      countryAr: country.nameAr,
      disclaimer: 'Mock policy modelled on public labour-law summaries, not legal advice.',
      probation: {
        days: country.probationDays,
        accruesAnnualLeave: country.probationAccruesAnnualLeave,
      },
      annualLeaveTiers: rules.annualLeave.map((tier) => ({
        appliesFrom: tier.minMonthsOfService ? `${tier.minMonthsOfService} months of service` : 'day one',
        orAge: tier.orMinAge ? `${tier.orMinAge}+ years old` : undefined,
        days: tier.days,
        accrualDaysPerMonth: tier.accrualDaysPerMonth,
        note: tier.note,
      })),
      sickLeaveTiers: rules.sickLeave,
      emergencyLeaveDaysPerYear: rules.emergencyLeaveDaysPerYear,
      emergencyMaxConsecutiveDays: rules.emergencyMaxConsecutiveDays,
    };
  }
}
