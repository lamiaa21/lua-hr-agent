import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { hris } from '../../clients/hris/index.js';

export class GetLeaveBalance implements LuaTool {
  name = 'get_leave_balance';
  description = "Get an employee's current leave balances (annual, sick, emergency) with the policy reasoning behind each entitlement.";
  inputSchema = z.object({
    employeeId: z.string().describe('The employee HRIS id, e.g. "emp003". Ask the employee for this if not already known.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const employee = await hris.getEmployee(input.employeeId);
    const balances = await hris.getLeaveBalances(input.employeeId);
    return {
      employee: {
        id: employee.id,
        displayName: employee.displayName,
        displayNameAr: employee.displayNameAr,
        country: employee.country,
      },
      balances,
    };
  }
}
