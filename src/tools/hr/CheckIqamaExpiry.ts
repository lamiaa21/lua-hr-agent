import { z } from 'zod';
import { env, type LuaTool } from 'lua-cli';
import { hris } from '../../clients/hris/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function daysUntil(dateIso: string): number {
  return Math.ceil((new Date(dateIso).getTime() - Date.now()) / DAY_MS);
}

/** 60/30/14-day urgency tiers, matching the alert tiering described in the PRD's job spec. */
function tierFor(daysUntilExpiry: number): 'urgent' | 'warning' | 'notice' {
  if (daysUntilExpiry <= 14) return 'urgent';
  if (daysUntilExpiry <= 30) return 'warning';
  return 'notice';
}

export class CheckIqamaExpiry implements LuaTool {
  name = 'check_iqama_expiry';
  description = "Check a KSA employee's Iqama (residency permit) expiry, or list every KSA employee whose Iqama is expiring soon.";
  inputSchema = z.object({
    employeeId: z.string().optional().describe('Check a single employee. Omit to list everyone inside the alert window.'),
    withinDays: z.number().int().positive().optional().describe('Alert window in days. Defaults to IQAMA_ALERT_THRESHOLD_DAYS.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const threshold = input.withinDays ?? Number(env('IQAMA_ALERT_THRESHOLD_DAYS') ?? '60');

    if (input.employeeId) {
      const employee = await hris.getEmployee(input.employeeId);
      if (employee.country !== 'SA' || !employee.iqamaExpiry) {
        return {
          employeeId: employee.id,
          employeeName: employee.displayName,
          applicable: false,
          note: 'Iqama tracking applies to KSA employees only.',
        };
      }
      const days = daysUntil(employee.iqamaExpiry);
      return {
        employeeId: employee.id,
        employeeName: employee.displayName,
        applicable: true,
        iqamaExpiry: employee.iqamaExpiry,
        daysUntilExpiry: days,
        withinAlertWindow: days >= 0 && days <= threshold,
        tier: days >= 0 && days <= threshold ? tierFor(days) : null,
      };
    }

    const atRisk = await hris.listEmployeesWithExpiringIqama(threshold);
    return {
      thresholdDays: threshold,
      count: atRisk.length,
      employees: atRisk
        .map((e) => {
          const days = daysUntil(e.iqamaExpiry!);
          return { employeeId: e.id, employeeName: e.displayName, iqamaExpiry: e.iqamaExpiry, daysUntilExpiry: days, tier: tierFor(days) };
        })
        .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry),
    };
  }
}
