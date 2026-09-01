import { Data } from 'lua-cli';
import { ageFromDateOfBirth, resolveAnnualLeave, resolveEmergencyLeave, resolveSickLeave } from '../../config/entitlements.js';
import { MOCK_EMPLOYEES, MOCK_LEAVE_USAGE } from '../../data/employees.mock.js';
import type {
  CreateLeaveRequestInput,
  Employee,
  HRISClient,
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const LEAVE_REQUESTS_COLLECTION = 'leave_requests';

/** Maps a stored Data entry back to the LeaveRequest shape tools expect. */
function toLeaveRequest(entryId: string, data: Record<string, any>): LeaveRequest {
  return { id: entryId, ...data } as LeaveRequest;
}

/**
 * Seeded fixture adapter — mirrors BambooHRAdapter's response shapes so the
 * agent's tools can't tell the difference. Default adapter (HRIS_MODE=mock)
 * so a clean clone works with zero credentials.
 *
 * Employee master data is static (seeded once, read-only). Leave requests
 * are written to Lua's Data store, not an in-memory array — each tool call
 * runs in its own isolated execution, so plain module state doesn't survive
 * between calls.
 */
export class MockBambooAdapter implements HRISClient {
  async getEmployee(id: string): Promise<Employee> {
    const employee = MOCK_EMPLOYEES.find((e) => e.id === id);
    if (!employee) throw new Error(`No employee found with id "${id}"`);
    return employee;
  }

  async findEmployeeByPhone(phone: string): Promise<Employee | null> {
    return MOCK_EMPLOYEES.find((e) => e.phone === phone) ?? null;
  }

  async getDirectReports(managerId: string): Promise<Employee[]> {
    return MOCK_EMPLOYEES.filter((e) => e.supervisorId === managerId);
  }

  async getLeaveBalances(employeeId: string): Promise<LeaveBalance[]> {
    const employee = await this.getEmployee(employeeId);
    const age = ageFromDateOfBirth(employee.dateOfBirth);

    const resolutions: Record<LeaveType, { days: number; policyNote: string }> = {
      annual: resolveAnnualLeave(employee.country, employee.hireDate, age),
      sick: resolveSickLeave(employee.country),
      emergency: resolveEmergencyLeave(employee.country),
    };

    // Used days = seeded baseline (leave already taken before this demo) plus
    // every approved request in the Data store, summed by type.
    const approved = await this.listLeaveRequests({ employeeId, status: 'approved' });
    const seeded = MOCK_LEAVE_USAGE[employeeId] ?? {};

    return (Object.keys(resolutions) as LeaveType[]).map((leaveType) => {
      const entitlementDays = resolutions[leaveType].days;
      const approvedDays = approved.filter((r) => r.leaveType === leaveType).reduce((sum, r) => sum + r.days, 0);
      const usedDays = (seeded[leaveType] ?? 0) + approvedDays;
      return {
        employeeId,
        leaveType,
        entitlementDays,
        usedDays,
        balanceDays: Math.max(0, entitlementDays - usedDays),
        policyNote: resolutions[leaveType].policyNote,
      };
    });
  }

  async createLeaveRequest(input: CreateLeaveRequestInput): Promise<LeaveRequest> {
    const employee = await this.getEmployee(input.employeeId);
    const start = new Date(input.startDate);
    const end = new Date(input.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      throw new Error(`Invalid date range: ${input.startDate} to ${input.endDate}`);
    }
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;

    const data = {
      employeeId: input.employeeId,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      days,
      status: 'pending' as LeaveStatus,
      approverId: employee.supervisorId ?? 'unassigned',
      reason: input.reason,
    };
    const entry = await Data.create(
      LEAVE_REQUESTS_COLLECTION,
      data,
      `${input.leaveType} leave for ${employee.displayName}, ${input.startDate} to ${input.endDate}`,
    );
    return toLeaveRequest(entry.id, data);
  }

  async listLeaveRequests(filter: {
    approverId?: string;
    employeeId?: string;
    status?: LeaveStatus;
  }): Promise<LeaveRequest[]> {
    const query: Record<string, string> = {};
    if (filter.approverId) query.approverId = filter.approverId;
    if (filter.employeeId) query.employeeId = filter.employeeId;
    if (filter.status) query.status = filter.status;

    const result = await Data.get(LEAVE_REQUESTS_COLLECTION, query, 1, 100);
    return result.data.map((entry) => toLeaveRequest(entry.id, entry.data));
  }

  async decideLeaveRequest(id: string, decision: 'approved' | 'rejected', note?: string): Promise<LeaveRequest> {
    let entry;
    try {
      entry = await Data.getEntry(LEAVE_REQUESTS_COLLECTION, id);
    } catch {
      throw new Error(`No leave request found with id "${id}"`);
    }
    if (entry.data.status !== 'pending') {
      throw new Error(`Leave request "${id}" is already ${entry.data.status}, cannot decide again`);
    }

    const updates = { status: decision, decidedAt: new Date().toISOString(), decisionNote: note };
    await Data.update(LEAVE_REQUESTS_COLLECTION, id, updates);
    return toLeaveRequest(id, { ...entry.data, ...updates });
  }

  async listEmployeesWithExpiringIqama(withinDays: number): Promise<Employee[]> {
    const now = Date.now();
    return MOCK_EMPLOYEES.filter((e) => {
      if (e.country !== 'SA' || !e.iqamaExpiry) return false;
      const daysUntilExpiry = (new Date(e.iqamaExpiry).getTime() - now) / DAY_MS;
      return daysUntilExpiry >= 0 && daysUntilExpiry <= withinDays;
    });
  }
}
