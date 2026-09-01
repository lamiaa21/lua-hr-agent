import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { hris } from '../../clients/hris/index.js';

export class DecideLeaveRequest implements LuaTool {
  name = 'decide_leave_request';
  description = 'Approve or reject a pending leave request. Always confirm with the manager which request and which decision before calling this.';
  inputSchema = z.object({
    requestId: z.string(),
    decision: z.enum(['approved', 'rejected']),
    note: z.string().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const request = await hris.decideLeaveRequest(input.requestId, input.decision, input.note);
    const balances = await hris.getLeaveBalances(request.employeeId);
    const updatedBalance = balances.find((b) => b.leaveType === request.leaveType);
    return { request, updatedBalance };
  }
}
