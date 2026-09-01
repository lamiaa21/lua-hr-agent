import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { hris } from '../../clients/hris/index.js';
import { CHECKINS_COL, getCheckinRows } from '../../clients/sheets/sheets.client.js';
import type { Employee } from '../../clients/hris/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfWeek(date: Date): Date {
  const monday = new Date(date);
  const day = monday.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

interface WeekStats {
  checkinCount: number;
  avgRating: number | null;
  blockers: string[];
}

function summarizeWeek(rows: string[][], employeeId: string, weekStart: Date, weekEnd: Date): WeekStats {
  const rowsForEmployee = rows.filter((r) => {
    if (r[CHECKINS_COL.employee_id] !== employeeId) return false;
    const d = new Date(r[CHECKINS_COL.date]);
    return d >= weekStart && d <= weekEnd;
  });

  const ratings = rowsForEmployee.map((r) => Number(r[CHECKINS_COL.rating])).filter((n) => !Number.isNaN(n));
  const blockers = rowsForEmployee.map((r) => r[CHECKINS_COL.blockers]).filter((b) => b && b.trim().length > 0);

  return {
    checkinCount: rowsForEmployee.length,
    avgRating: ratings.length > 0 ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)) : null,
    blockers,
  };
}

async function resolveManager(nameOrId: string): Promise<Employee> {
  try {
    return await hris.getEmployee(nameOrId);
  } catch {
    const match = await hris.findEmployeeByName(nameOrId);
    if (!match) throw new Error(`No employee found matching "${nameOrId}"`);
    return match;
  }
}

export class GetTeamSummary implements LuaTool {
  name = 'get_team_summary';
  description = "Summarize a manager's direct reports' daily check-ins for the current week: average rating, check-in count, recurring blockers, and trend vs the prior week.";
  inputSchema = z.object({
    managerNameOrId: z.string().describe('The manager\'s name (e.g. "Ahmad") or HRIS id (e.g. "emp001").'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const manager = await resolveManager(input.managerNameOrId);
    const directReports = await hris.getDirectReports(manager.id);
    if (directReports.length === 0) {
      return { manager: manager.displayName, team: [], note: 'This manager has no direct reports on file.' };
    }

    const rows = await getCheckinRows();
    const currentWeekStart = startOfWeek(new Date());
    const currentWeekEnd = new Date(currentWeekStart.getTime() + 6 * DAY_MS + (DAY_MS - 1));
    const previousWeekStart = new Date(currentWeekStart.getTime() - 7 * DAY_MS);
    const previousWeekEnd = new Date(currentWeekStart.getTime() - 1);

    const team = directReports.map((employee) => {
      const current = summarizeWeek(rows, employee.id, currentWeekStart, currentWeekEnd);
      const previous = summarizeWeek(rows, employee.id, previousWeekStart, previousWeekEnd);

      const blockerCounts = new Map<string, number>();
      for (const b of current.blockers) blockerCounts.set(b, (blockerCounts.get(b) ?? 0) + 1);
      const recurringBlockers = [...blockerCounts.entries()].filter(([, count]) => count > 1).map(([b]) => b);

      let trend: { direction: 'up' | 'down' | 'flat' | 'no_data'; delta: number | null } = {
        direction: 'no_data',
        delta: null,
      };
      if (current.avgRating !== null && previous.avgRating !== null) {
        const delta = Number((current.avgRating - previous.avgRating).toFixed(2));
        trend = { direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', delta };
      }

      return {
        employeeId: employee.id,
        employeeName: employee.displayName,
        checkinCount: current.checkinCount,
        avgRating: current.avgRating,
        blockers: current.blockers,
        recurringBlockers,
        trendVsPreviousWeek: trend,
      };
    });

    return {
      manager: manager.displayName,
      weekStart: currentWeekStart.toISOString().slice(0, 10),
      team,
    };
  }
}
