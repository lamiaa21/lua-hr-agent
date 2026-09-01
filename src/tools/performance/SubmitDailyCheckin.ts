import { z } from 'zod';
import { Lua, type LuaTool } from 'lua-cli';
import { hris } from '../../clients/hris/index.js';
import { appendCheckinRow } from '../../clients/sheets/sheets.client.js';

const CheckinEntry = z.object({
  employeeId: z.string(),
  accomplished: z.string().describe('What the employee got done today'),
  blockers: z.string().describe('Anything blocking them — empty string if none'),
  rating: z.number().int().min(1).max(5).describe('1 (struggling) to 5 (great day)'),
});

export class SubmitDailyCheckin implements LuaTool {
  name = 'submit_daily_checkin';
  description = "Record a team lead's daily check-in entries for one or more of their direct reports. Writes one row per entry to the performance tracking sheet.";
  inputSchema = z.object({
    teamLeadId: z.string().describe('The team lead\'s HRIS id, e.g. "emp001".'),
    date: z.string().describe('ISO date the check-in is for, e.g. 2026-09-01'),
    entries: z.array(CheckinEntry).min(1),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const teamLead = await hris.getEmployee(input.teamLeadId);
    const directReports = await hris.getDirectReports(input.teamLeadId);
    const directReportsById = new Map(directReports.map((e) => [e.id, e]));

    const invalidIds = input.entries.map((e) => e.employeeId).filter((id) => !directReportsById.has(id));
    if (invalidIds.length > 0) {
      throw new Error(
        `These employee id(s) are not direct reports of ${teamLead.displayName} (${input.teamLeadId}): ${invalidIds.join(', ')}`,
      );
    }

    const channel = Lua.request?.channel ?? 'test';
    const timestamp = new Date().toISOString();

    for (const entry of input.entries) {
      const employee = directReportsById.get(entry.employeeId)!;
      await appendCheckinRow([
        timestamp,
        input.date,
        teamLead.id,
        teamLead.displayName,
        employee.id,
        employee.displayName,
        employee.department,
        employee.country,
        entry.accomplished,
        entry.blockers,
        String(entry.rating),
        channel,
        teamLead.preferredLanguage,
      ]);
    }

    return { recorded: input.entries.length, teamLead: teamLead.displayName, date: input.date };
  }
}
