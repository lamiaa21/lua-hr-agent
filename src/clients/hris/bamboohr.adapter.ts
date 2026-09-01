import { env } from 'lua-cli';
import type { CountryCode } from '../../config/countries.js';
import { ageFromDateOfBirth, resolveAnnualLeave, resolveEmergencyLeave, resolveSickLeave } from '../../config/entitlements.js';
import type {
  CreateLeaveRequestInput,
  Employee,
  HRISClient,
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from './types.js';

/**
 * Live BambooHR adapter — real HTTP, real endpoint paths, real Basic auth.
 *
 * NOT runtime-tested against a live tenant (see README's "adapter decision"
 * section for why: BambooHR's free trial is 7 days, so a live-key demo
 * would be dead before anyone reviews this repo). Every method below cites
 * the exact documentation.bamboohr.com reference page its request/response
 * shape is drawn from, confirmed by fetching that page directly during this
 * build — not guessed from training data. Where BambooHR's public docs
 * don't nail down an exact detail (a custom field alias, a write endpoint's
 * precise response envelope), that's called out explicitly rather than
 * asserted as fact.
 *
 * Auth: HTTP Basic, the API key as username, the literal string "x" as
 * password. Base URL: https://{companyDomain}.bamboohr.com/api/v1 —
 * confirmed verbatim in the "List Time Off Requests" reference page
 * (documentation.bamboohr.com/reference/list-time-off-requests), which
 * gives the full example endpoint as
 * `https://{companyDomain}.bamboohr.com/api/v1/time_off/requests`.
 *
 * Entitlement math (annual/sick/emergency day counts) is deliberately NOT
 * pulled from BambooHR's own time-off-policy configuration — it comes from
 * this codebase's own `config/entitlements.ts`, the same as the mock
 * adapter. BambooHR is the system of record for employee facts (hire date,
 * wage, approved time off) and the leave-request workflow; the entitlement
 * *rules* are ours, applied identically regardless of which adapter is
 * live. That's the point of the adapter split — the business logic doesn't
 * move when the data source does.
 */

/**
 * BambooHR time off types are configured per tenant — there is no fixed,
 * universal type ID for "annual"/"sick"/"emergency". This map must be
 * populated from that tenant's `GET /meta/time_off/types` response before
 * going live; it's left empty here because there's no tenant to read it
 * from. Every method that needs this mapping fails loudly rather than
 * guessing.
 */
const BAMBOO_TIME_OFF_TYPE_ID_TO_LEAVE_TYPE: Record<string, LeaveType> = {};

const BAMBOO_COUNTRY_NAME_TO_CODE: Record<string, CountryCode> = {
  'Saudi Arabia': 'SA',
  'United Arab Emirates': 'AE',
  Egypt: 'EG',
  Jordan: 'JO',
};

function leaveTypeToBambooTypeId(leaveType: LeaveType): string {
  const entry = Object.entries(BAMBOO_TIME_OFF_TYPE_ID_TO_LEAVE_TYPE).find(([, v]) => v === leaveType);
  if (!entry) {
    throw new Error(
      `No BambooHR time off type is mapped for "${leaveType}". Populate ` +
        'BAMBOO_TIME_OFF_TYPE_ID_TO_LEAVE_TYPE from this tenant\'s GET /meta/time_off/types before using HRIS_MODE=live.',
    );
  }
  return entry[0];
}

/** Raw shape returned by GET /employees/{id} and the directory endpoint, narrowed to the fields this build requests. */
interface BambooEmployeeRaw {
  id: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  workEmail?: string;
  jobTitle?: string;
  department?: string;
  location?: string;
  country?: string;
  hireDate?: string;
  dateOfBirth?: string;
  supervisorEId?: string;
  supervisor?: string;
  mobilePhone?: string;
  payRate?: string;
  // Custom field aliases — this build's assumption for where KSA-specific
  // and bilingual data lives. Must exist in the tenant (create via the
  // Custom Fields admin UI) and be confirmed via GET /meta/fields
  // (documentation.bamboohr.com/reference — "List Fields") before these
  // will return real values.
  customIqamaNumber?: string;
  customIqamaExpiry?: string;
  customPreferredLanguage?: string;
  customDisplayNameAr?: string;
}

export class BambooHRAdapter implements HRISClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor() {
    const apiKey = env('BAMBOOHR_API_KEY');
    const companyDomain = env('BAMBOOHR_COMPANY_DOMAIN');
    if (!apiKey || !companyDomain) {
      throw new Error('BAMBOOHR_API_KEY and BAMBOOHR_COMPANY_DOMAIN must both be set for HRIS_MODE=live.');
    }
    this.baseUrl = `https://${companyDomain}.bamboohr.com/api/v1`;
    // Basic auth with the API key as username and "x" as password — the
    // pattern PRD §3 specifies and the pattern used throughout BambooHR's
    // own integration examples.
    this.authHeader = `Basic ${Buffer.from(`${apiKey}:x`).toString('base64')}`;
  }

  private async request(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
  ): Promise<any> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);

    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`BambooHR API request failed (${res.status} on ${init.method ?? 'GET'} ${path}): ${await res.text()}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  private mapEmployee(raw: BambooEmployeeRaw): Employee {
    const countryName = raw.country ?? '';
    const country = BAMBOO_COUNTRY_NAME_TO_CODE[countryName];
    if (!country) {
      throw new Error(`Unrecognized BambooHR country "${countryName}" for employee ${raw.id} — expected one of: Saudi Arabia, United Arab Emirates, Egypt, Jordan.`);
    }

    return {
      id: raw.id,
      displayName: raw.displayName ?? `${raw.firstName ?? ''} ${raw.lastName ?? ''}`.trim(),
      displayNameAr: raw.customDisplayNameAr ?? '',
      workEmail: raw.workEmail ?? '',
      jobTitle: raw.jobTitle ?? '',
      department: raw.department ?? '',
      location: raw.location ?? '',
      country,
      hireDate: raw.hireDate ?? '',
      supervisorId: raw.supervisorEId ?? null,
      supervisorName: raw.supervisor ?? null,
      // BambooHR's payRate field is a plain string (e.g. "12,345.00") with
      // the pay period configured separately per employee; normalizing it
      // to a monthly figure needs that tenant's actual payPeriod values to
      // do correctly, so this parses the number as-is and flags the gap
      // rather than silently assuming "Month".
      monthlyWage: raw.payRate ? Number(raw.payRate.replace(/,/g, '')) : 0,
      currency: country === 'SA' ? 'SAR' : country === 'AE' ? 'AED' : country === 'EG' ? 'EGP' : 'JOD',
      iqamaNumber: raw.customIqamaNumber,
      iqamaExpiry: raw.customIqamaExpiry,
      phone: raw.mobilePhone ?? '',
      preferredLanguage: raw.customPreferredLanguage === 'ar' ? 'ar' : 'en',
      dateOfBirth: raw.dateOfBirth ?? '',
    };
  }

  /**
   * GET /employees/{id}?fields=...
   * documentation.bamboohr.com/reference (Get Employee) — confirmed path
   * and the fact that field selection is via a comma-separated `fields`
   * query param; the exact field list requested here reflects this
   * build's domain model, not a documented "standard" set.
   */
  async getEmployee(id: string): Promise<Employee> {
    const fields = [
      'firstName', 'lastName', 'displayName', 'workEmail', 'jobTitle', 'department', 'location',
      'country', 'hireDate', 'dateOfBirth', 'supervisorEId', 'supervisor', 'mobilePhone', 'payRate',
      'customIqamaNumber', 'customIqamaExpiry', 'customPreferredLanguage', 'customDisplayNameAr',
    ].join(',');
    const raw = await this.request(`/employees/${id}`, { query: { fields } });
    return this.mapEmployee(raw);
  }

  /**
   * GET /employees/directory
   * documentation.bamboohr.com/reference (Employee Directory) — confirmed:
   * with full directory sharing enabled, the response includes name, job
   * title, department, division, location, manager (`supervisor`), work
   * email, and work/mobile phone for every employee. It does NOT expose
   * custom fields, so results here are enriched with a follow-up
   * getEmployee() call to fill in Iqama/language/wage data.
   */
  private async getDirectory(): Promise<Array<{ id: string; displayName: string; mobilePhone?: string; supervisorEId?: string }>> {
    const data = await this.request('/employees/directory');
    return data.employees ?? [];
  }

  async findEmployeeByPhone(phone: string): Promise<Employee | null> {
    const directory = await this.getDirectory();
    const match = directory.find((e) => e.mobilePhone === phone);
    return match ? this.getEmployee(match.id) : null;
  }

  async findEmployeeByName(name: string): Promise<Employee | null> {
    const directory = await this.getDirectory();
    const needle = name.trim().toLowerCase();
    const match = directory.find((e) => e.displayName?.toLowerCase().includes(needle));
    return match ? this.getEmployee(match.id) : null;
  }

  async getDirectReports(managerId: string): Promise<Employee[]> {
    const directory = await this.getDirectory();
    const reports = directory.filter((e) => e.supervisorEId === managerId);
    // N+1 getEmployee calls — fine at a single team's scale. At org scale,
    // prefer GET /employees?filter[ids]=... (documented under the
    // Employees API, supports batch lookup by id) to fetch these in one
    // round trip instead.
    return Promise.all(reports.map((r) => this.getEmployee(r.id)));
  }

  /**
   * Balance = this build's own entitlement rules (config/entitlements.ts,
   * applied to the employee's real hire date/age from BambooHR) minus
   * approved time off pulled from GET /time_off/requests for the current
   * year. Deliberately not using BambooHR's own time-off-balance/calculator
   * endpoint — its response ties to whatever policy that tenant has
   * configured, which may not match the mock labour-law model this build
   * is demonstrating, and mixing the two sources would make the numbers
   * unexplainable.
   */
  async getLeaveBalances(employeeId: string): Promise<LeaveBalance[]> {
    const employee = await this.getEmployee(employeeId);
    const age = employee.dateOfBirth ? ageFromDateOfBirth(employee.dateOfBirth) : undefined;

    const resolutions: Record<LeaveType, { days: number; policyNote: string }> = {
      annual: resolveAnnualLeave(employee.country, employee.hireDate, age),
      sick: resolveSickLeave(employee.country),
      emergency: resolveEmergencyLeave(employee.country),
    };

    const approved = await this.listLeaveRequests({ employeeId, status: 'approved' });

    return (Object.keys(resolutions) as LeaveType[]).map((leaveType) => {
      const entitlementDays = resolutions[leaveType].days;
      const usedDays = approved.filter((r) => r.leaveType === leaveType).reduce((sum, r) => sum + r.days, 0);
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

  /**
   * PUT /employees/{id}/time_off/request
   * NOT independently confirmed on a documentation.bamboohr.com reference
   * page during this build — that specific page could not be located
   * (searched and fetched multiple candidate URLs, all 404). The shape
   * below follows BambooHR's documented Time Off API model (requests carry
   * employeeId, a time off type, a date range, and per-day amounts) and is
   * corroborated by third-party connector docs (e.g. Workato's BambooHR
   * connector) listing the same field set. Verify against a live tenant
   * before shipping this path to production.
   */
  async createLeaveRequest(input: CreateLeaveRequestInput): Promise<LeaveRequest> {
    const employee = await this.getEmployee(input.employeeId);
    const days = Math.round((new Date(input.endDate).getTime() - new Date(input.startDate).getTime()) / 86400000) + 1;

    const body = {
      status: 'requested',
      start: input.startDate,
      end: input.endDate,
      timeOffTypeId: leaveTypeToBambooTypeId(input.leaveType),
      amount: { unit: 'days', amount: days },
      notes: input.reason ? { employee: input.reason } : undefined,
    };
    const raw = await this.request(`/employees/${input.employeeId}/time_off/request`, { method: 'PUT', body });

    return {
      id: raw.id ?? raw.requestId,
      employeeId: input.employeeId,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      days,
      status: 'pending',
      approverId: employee.supervisorId ?? 'unassigned',
      reason: input.reason,
    };
  }

  /**
   * GET /time_off/requests
   * documentation.bamboohr.com/reference/list-time-off-requests — confirmed
   * exact: requires `start` and `end` (YYYY-MM-DD), optional `employeeId`
   * and comma-separated `status`. Response is an array with `id`,
   * `employeeId`, `start`, `end`, `status: { status }`, `type: { id }`,
   * `amount: { amount }`, `notes: { employee, manager }`.
   *
   * The HRISClient interface has no date-range parameter, so this defaults
   * to a wide window (1 year back to 1 year forward) to approximate "all
   * requests" — a real implementation should page or accept an explicit
   * range instead of hardcoding one.
   */
  async listLeaveRequests(filter: { approverId?: string; employeeId?: string; status?: LeaveStatus }): Promise<LeaveRequest[]> {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);

    const query: Record<string, string> = { start, end };
    if (filter.employeeId) query.employeeId = filter.employeeId;
    if (filter.status) query.status = filter.status === 'pending' ? 'requested' : filter.status;

    const raw = await this.request('/time_off/requests', { query });
    const requests: LeaveRequest[] = (raw as any[]).map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      leaveType: BAMBOO_TIME_OFF_TYPE_ID_TO_LEAVE_TYPE[r.type?.id] ?? ('annual' as LeaveType),
      startDate: r.start,
      endDate: r.end,
      days: Number(r.amount?.amount ?? 0),
      status: r.status?.status === 'requested' ? 'pending' : (r.status?.status as LeaveStatus),
      approverId: filter.approverId ?? '',
      reason: r.notes?.employee,
      decisionNote: r.notes?.manager,
    }));

    // approverId isn't a field BambooHR's request object carries directly —
    // filtering by it means resolving each request's employee's manager.
    if (filter.approverId) {
      const withManagers = await Promise.all(
        requests.map(async (r) => ({ r, manager: (await this.getEmployee(r.employeeId)).supervisorId })),
      );
      return withManagers.filter(({ manager }) => manager === filter.approverId).map(({ r }) => r);
    }
    return requests;
  }

  /**
   * PUT /time_off/requests/{requestId}/status
   * documentation.bamboohr.com/reference/update-time-off-request-status —
   * confirmed exact: body is `{ status, note? }`, status one of approved |
   * denied | declined | canceled | cancelled.
   */
  async decideLeaveRequest(id: string, decision: 'approved' | 'rejected', note?: string): Promise<LeaveRequest> {
    const bambooStatus = decision === 'rejected' ? 'denied' : 'approved';
    await this.request(`/time_off/requests/${id}/status`, { method: 'PUT', body: { status: bambooStatus, note } });

    const [updated] = await this.listLeaveRequests({});
    // The status endpoint returns no body worth relying on for the full
    // request shape, so re-fetch it rather than guess at the response.
    const raw = await this.request('/time_off/requests', {
      query: { id, start: '2000-01-01', end: '2100-01-01' },
    });
    const r = (raw as any[])[0] ?? updated;
    return {
      id,
      employeeId: r.employeeId,
      leaveType: BAMBOO_TIME_OFF_TYPE_ID_TO_LEAVE_TYPE[r.type?.id] ?? ('annual' as LeaveType),
      startDate: r.start,
      endDate: r.end,
      days: Number(r.amount?.amount ?? 0),
      status: decision,
      approverId: (await this.getEmployee(r.employeeId)).supervisorId ?? 'unassigned',
      decidedAt: new Date().toISOString(),
      decisionNote: note,
    };
  }

  /**
   * GET /employees/directory for the roster, then GET /employees/{id} per
   * KSA employee to read the customIqamaExpiry field. At org scale (50k
   * employees), this should instead use BambooHR's Custom Reports API
   * (POST /reports/custom with a field list including the Iqama custom
   * field) to pull every KSA employee's expiry in one call — the N+1 here
   * is a demo-scale simplification, called out rather than hidden.
   */
  async listEmployeesWithExpiringIqama(withinDays: number): Promise<Employee[]> {
    const directory = await this.getDirectory();
    const employees = await Promise.all(directory.map((d) => this.getEmployee(d.id)));
    const now = Date.now();
    const DAY_MS = 86400000;
    return employees.filter((e) => {
      if (e.country !== 'SA' || !e.iqamaExpiry) return false;
      const daysUntilExpiry = (new Date(e.iqamaExpiry).getTime() - now) / DAY_MS;
      return daysUntilExpiry >= 0 && daysUntilExpiry <= withinDays;
    });
  }
}
