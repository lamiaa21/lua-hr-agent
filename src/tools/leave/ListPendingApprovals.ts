import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { hris } from '../../clients/hris/index.js';

export class ListPendingApprovals implements LuaTool {
  name = 'list_pending_approvals';
  description = 'List leave requests awaiting a manager\'s decision.';
  inputSchema = z.object({
    approverId: z.string().describe('The manager\'s HRIS id, e.g. "emp001".'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const requests = await hris.listLeaveRequests({ approverId: input.approverId, status: 'pending' });
    const withNames = await Promise.all(
      requests.map(async (r) => {
        const employee = await hris.getEmployee(r.employeeId);
        return { ...r, employeeName: employee.displayName };
      }),
    );
    return { pendingCount: withNames.length, requests: withNames };
  }
}
