import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { hris } from '../../clients/hris/index.js';

export class RequestLeave implements LuaTool {
  name = 'request_leave';
  description = 'Submit a leave request for an employee after confirming they have enough balance. Always confirm the dates and type with the employee before calling this.';
  inputSchema = z.object({
    employeeId: z.string().describe('The requesting employee\'s HRIS id, e.g. "emp003".'),
    leaveType: z.enum(['annual', 'sick', 'emergency']),
    startDate: z.string().describe('ISO date, e.g. 2026-10-01'),
    endDate: z.string().describe('ISO date, inclusive, e.g. 2026-10-05'),
    reason: z.string().optional(),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const balances = await hris.getLeaveBalances(input.employeeId);
    const balance = balances.find((b) => b.leaveType === input.leaveType);
    if (!balance) throw new Error(`No ${input.leaveType} leave policy found for employee ${input.employeeId}`);

    const requestedDays = Math.round((new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) / 86400000) + 1;
    if (requestedDays > balance.balanceDays) {
      throw new Error(
        `Insufficient ${input.leaveType} leave balance: requested ${requestedDays} day(s), ` +
          `only ${balance.balanceDays} remaining (${balance.policyNote}).`,
      );
    }

    const request = await hris.createLeaveRequest(input);
    return { request, remainingBalanceAfterApproval: balance.balanceDays - request.days };
  }
}
