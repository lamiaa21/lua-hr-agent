import { z } from 'zod';
import type { LuaTool } from 'lua-cli';
import { hris } from '../../clients/hris/index.js';
import { calculateKsaGratuity } from '../../config/gratuity.js';
import { yearsOfService } from '../../config/entitlements.js';

export class CalculateGratuity implements LuaTool {
  name = 'calculate_gratuity';
  description = "Calculate an employee's end-of-service gratuity (KSA only in this build), with a step-by-step breakdown and the rules cited.";
  inputSchema = z.object({
    employeeId: z.string(),
    separationType: z.enum(['resignation', 'termination']),
    asOfDate: z.string().optional().describe('ISO date to calculate as of. Defaults to today.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const employee = await hris.getEmployee(input.employeeId);
    if (employee.country !== 'SA') {
      throw new Error(
        `Gratuity is only modelled for KSA (SA) employees in this build. ${employee.displayName} is based in ${employee.country}.`,
      );
    }

    const years = yearsOfService(employee.hireDate, input.asOfDate);
    const result = calculateKsaGratuity(employee.monthlyWage, years, input.separationType);

    return {
      employee: { id: employee.id, displayName: employee.displayName },
      separationType: input.separationType,
      currency: employee.currency,
      disclaimer: 'Mock policy modelled on public labour-law summaries, not legal advice.',
      ...result,
    };
  }
}
