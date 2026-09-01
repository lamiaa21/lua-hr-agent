import type { CountryCode } from '../../config/countries.js';

export type LeaveType = 'annual' | 'sick' | 'emergency';
export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface Employee {
  id: string;
  displayName: string;
  displayNameAr: string;
  workEmail: string;
  jobTitle: string;
  department: string;
  location: string;
  country: CountryCode;
  hireDate: string;
  supervisorId: string | null;
  supervisorName: string | null;
  monthlyWage: number;
  currency: string;
  iqamaNumber?: string;
  iqamaExpiry?: string;
  phone: string;
  preferredLanguage: 'en' | 'ar';
  dateOfBirth: string;
}

export interface LeaveBalance {
  employeeId: string;
  leaveType: LeaveType;
  entitlementDays: number;
  usedDays: number;
  balanceDays: number;
  policyNote: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveStatus;
  approverId: string;
  reason?: string;
  decidedAt?: string;
  decisionNote?: string;
}

export interface CreateLeaveRequestInput {
  employeeId: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string;
}

/**
 * HRISClient is the seam between the agent's tools and the HR system of
 * record. BambooHRAdapter (live) and MockBambooAdapter (seeded) both
 * implement it — see clients/hris/index.ts for the HRIS_MODE switch.
 */
export interface HRISClient {
  getEmployee(id: string): Promise<Employee>;
  findEmployeeByPhone(phone: string): Promise<Employee | null>;
  /**
   * Case-insensitive name lookup, added beyond the original interface sketch
   * so "How did Ahmad's team perform?" can resolve a manager from a first
   * name alone, not just an HRIS id.
   */
  findEmployeeByName(name: string): Promise<Employee | null>;
  getDirectReports(managerId: string): Promise<Employee[]>;
  getLeaveBalances(employeeId: string): Promise<LeaveBalance[]>;
  createLeaveRequest(input: CreateLeaveRequestInput): Promise<LeaveRequest>;
  listLeaveRequests(filter: {
    approverId?: string;
    employeeId?: string;
    status?: LeaveStatus;
  }): Promise<LeaveRequest[]>;
  decideLeaveRequest(id: string, decision: 'approved' | 'rejected', note?: string): Promise<LeaveRequest>;
  listEmployeesWithExpiringIqama(withinDays: number): Promise<Employee[]>;
}
