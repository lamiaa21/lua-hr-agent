# HR Agent — Lua Take-Home

This README is written as a Loom script — read it in order and it's the walkthrough.

## Quickstart

Works from a clean clone with zero credentials (`HRIS_MODE=mock` is the default).

```powershell
git clone https://github.com/lamiaa21/lua-hr-agent.git
cd lua-hr-agent
npm install
copy .env.example .env
# edit .env: HRIS_MODE=mock is enough to run the demo below.
# GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_JSON_B64 are only needed for the
# performance skill's Sheets writes — leave/gratuity/iqama/KB all work
# without them.

lua auth configure          # sign in
lua test skill --name get_leave_balance --input "{\"employeeId\":\"emp001\"}"
lua push
lua deploy all --force
lua chat -e production -t -m "How did Ahmad's team perform this week?"
```

To load the knowledge base (needed for `search_hr_knowledge` / policy questions):

```powershell
npm run seed-kb
```

## 1. The problem

A 50,000-employee industrial conglomerate headquartered in Riyadh, with operations in the UAE, Egypt, and Jordan. Zero existing HR tech — leave requests happen over WhatsApp and paper, four different countries' labour rules live in people's heads, and nobody has a consistent answer to "how much annual leave do I have left."

## 2. What I built

Two of the brief's four workflows:

- **Leave management** — balances with the reasoning behind them, requests, and manager approvals, in English or Arabic.
- **Daily performance management** — team leads log check-ins, managers get a weekly summary with trend and blockers.

Why these two: leave exercises the BambooHR integration, bilingual handling, and per-country business rules. Performance exercises the Google Sheets integration and (per the brief, mostly deprioritized here) scheduled jobs. Together they cover both mandated integrations with no wasted overlap.

## 3. Architecture

```
                   ┌──────────────┐        ┌──────────────┐
   Office staff ──▶│  LuaPop web  │        │  WhatsApp    │◀── Field workers
                   └──────┬───────┘        └──────┬───────┘
                          └───────────┬───────────┘
                                      ▼
                            ┌───────────────────┐
                            │   Lua Agent       │
                            │   (hr-agent,      │
                            │    bilingual)     │
                            └─────────┬─────────┘
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
            ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
            │ leave-        │ │ performance-  │ │ hr-core       │
            │ management    │ │ management    │ │ (gratuity,    │
            │ skill         │ │ skill         │ │  iqama, KB)   │
            └───────┬───────┘ └───────┬───────┘ └───────┬───────┘
                    │                 │                 │
                    ▼                 ▼                 ▼
            ┌───────────────┐ ┌───────────────┐ ┌───────────────┐
            │ HRISClient    │ │ Sheets client │ │ Lua Data      │
            │ (interface)   │ │ (raw fetch)   │ │ store (KB)    │
            └───────┬───────┘ └───────────────┘ └───────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
  BambooHRAdapter        MockBambooAdapter
  (live, real REST,      (seeded, default,
   untested — no          persists via Data
   live tenant)           store for state)
```

Agent → skill → tool is a straight decomposition: three skills (`leave-management`, `performance-management`, `hr-core`), each holding the tools for one concern, each with its own `context` telling the model when and how to use them. The persona owns language, tone, and the "never invent policy" rule; skill `context` owns tool-specific procedure (confirm before submitting, always relay the policy note, etc).

One thing that isn't obvious from the diagram: **tools run in an isolated sandbox per call** — there's no in-memory state between two calls in the same conversation, even in `lua test`. I found this out the hard way (see §8). `MockBambooAdapter` therefore persists leave requests through Lua's `Data` store instead of a plain array — the same mechanism the KB uses.

## 4. The adapter decision

`HRISClient` is a TypeScript interface with two implementations:

- **`MockBambooAdapter`** — seeded fixtures (12 employees, weighted to KSA), mirrors BambooHR's response shapes, default via `HRIS_MODE=mock`.
- **`BambooHRAdapter`** — real HTTP, real endpoint paths (`https://{companyDomain}.bamboohr.com/api/v1/...`), real Basic auth (API key as username, `x` as password). Fully written, not stubbed with `throw new Error('not implemented')`.

BambooHR's free trial is 7 days, so a live-key demo would be dead by the time anyone reviews this repo. The adapter split means the integration is real, reviewable, and reproducible without a live tenant. This is a deliberate engineering decision, not a shortcut.

**Honesty about the live adapter:** it was written by reading `documentation.bamboohr.com` directly (endpoint paths and response shapes for `GET /employees/{id}`, `GET /employees/directory`, `GET /time_off/requests`, and `PUT /time_off/requests/{id}/status` are confirmed verbatim from the live docs) but it has never run against a real tenant. Every method has a comment block citing exactly which page its shape came from, and flagging the two places I couldn't fully confirm from public docs: the exact write shape for creating a new time-off request (inferred from BambooHR's general Time Off model plus a third-party connector's field list, since I couldn't locate BambooHR's own reference page for it), and the custom field aliases for Iqama data and the Arabic display name (those are always tenant-specific — there's no universal name to look up). The entitlement math itself (21 vs 30 days, gratuity tiers, etc.) is **not** pulled from BambooHR's own policy config in either adapter — it's this codebase's `config/entitlements.ts`, applied to real employee facts. That's the actual point of the split: the business rules don't move when the data source does.

## 5. Country rules as data

`config/entitlements.ts` and `config/gratuity.ts` encode the leave tables and gratuity formula as arrays of rule objects, not `if/else` chains. Adding a fifth country or a new tier is a data edit. Every resolved balance carries a `policyNote` explaining which rule fired and why — e.g. "KSA: 30 days after 5 years of service (>5y threshold) (6.4y service)" — because showing the reasoning is the difference between a lookup and an HR agent. Probation length and whether annual leave accrues during it are encoded the same way in `config/countries.ts`.

These are mock figures modelled on public labour-law summaries. They are labelled as such everywhere they surface — in code comments, in tool output, and in the KB documents — because overclaiming legal accuracy here would be worse than flagging the gap.

## 6. The refusal path

`search_hr_knowledge` runs a vector search over 11 seeded KB documents (leave, sick leave, probation, gratuity, Iqama renewal, salary certificates, exit/re-entry visas, public holidays — English and Arabic where the brief asked for both) and returns the source document's title with every answer so the agent can cite it.

If nothing relevant comes back, it returns an explicit `found: false` signal, and the persona is instructed to say so plainly and escalate to HR rather than guess. Hallucinated HR policy is the worst possible failure mode for this product, so this path got tested deliberately, not assumed: a genuinely relevant query and a genuinely irrelevant one ("what's the office wifi password") side by side, comparing scores. The irrelevant query still scored 0.56–0.58 against real documents — vector similarity between unrelated short texts is higher than intuition suggests — so a naive 0.5 threshold would have let noise through as an "answer." Relevant queries were scoring 0.7–0.82. The threshold sits at **0.65**, in the gap between those two clusters, tuned against real numbers rather than picked upfront.

## 7. Multi-channel

One agent, one build: `web/index.html` embeds LuaPop with a single script tag (no custom portal — the brief is explicit that LuaPop already is the portal). WhatsApp uses Lua's quick-testing channel — no Meta business account, no separate integration code. Same skills, same tools, same persona; the channel is just where the message came from. `submit_daily_checkin` reads the actual channel via `Lua.request.channel` to log it on the check-in row, which is the only place channel-awareness appears in the tool code at all.

**Manual steps I can't do for you:**
- **Web:** open `web/index.html`'s hosting domain under **Chat Widget → Customization** in the Lua Admin Dashboard and add it to the allowed-sites list — the widget silently refuses to load on an unlisted domain.
- **WhatsApp:** from your own phone, open `https://wa.me/13023778932?text=link-me-to:baseAgent_agent_1788282506715_rhepqvec9` and tap send. That links your WhatsApp to this agent for testing. Send `unlink-me` to disconnect.

## 8. Two things that broke, and what they taught me

**`googleapis` crashed the compiler.** The full SDK pulls in generated types for every Google API; Lua's `ts-morph`-based build ran out of heap trying to process it. Swapping to the scoped `@googleapis/sheets` package fixed the memory issue, but then the Sheets client failed at runtime with `ReadableStream is not defined` — the tool execution sandbox is a restricted environment (Node-based, but `child_process` and some Node/Web globals are stripped) and `gaxios`'s HTTP transport needs `ReadableStream`. I dropped the SDK entirely and hand-signed the service-account JWT with `node:crypto` + raw `fetch`, both of which the sandbox does support. `src/clients/sheets/sheets.client.ts` has no third-party HTTP dependency as a result — smaller surface, and it actually runs.

**Production silently had no environment variables.** `lua test` and `lua chat` (sandbox) both read the local `.env` file, so everything worked locally. The first `lua chat -e production` call for the performance skill failed with `GOOGLE_SERVICE_ACCOUNT_JSON_B64 is not set`. Production env vars are a separate store from `.env`, set via `lua env production -k KEY -v VALUE` — `lua push`/`lua deploy` don't carry `.env` values across. Worth knowing before assuming "it worked locally" means "it's live."

**The model was inconsistently ignoring the language instruction.** `google/gemini-2.5-flash` (the dashboard's default) sometimes answered English questions in Arabic — reproducibly, not a one-off, and independent of thread/conversation history (I ruled that out first, since `lua chat` without `-t` reuses a default thread). Strengthening the persona's language wording didn't fix it. My best working theory: every tool result includes both `displayName` and `displayNameAr`, and Flash sometimes mirrors the Arabic script it sees in the tool output rather than the user's own message. Switching the model to `anthropic/claude-haiku-4-5` resolved it — verified across multiple English and Arabic fresh-thread trials, including the full bilingual leave-request flow end to end. Haiku also stopped inventing custom `::: card :::` block syntax that Flash produced for structured responses (which WhatsApp and the chat widget would have rendered as literal garbled text) — a formatting instruction plus the model switch fixed both issues together.

## 9. Demo

- **Arabic leave request, end to end:** `"اريد ان اطلب اجازة سنوية من 1 اكتوبر الى 5 اكتوبر، رقمي الوظيفي emp003"` → agent checks balance, confirms in Arabic, submits on confirmation, returns the request id and remaining balance.
- **A check-in:** as Ahmad (`emp001`), `"Log a check-in for emp004 today: finished the deployment pipeline, no blockers, rating 4."` → confirms, writes a row to the `checkins` tab.
- **The brief's exact question:** `"How did Ahmad's team perform this week?"` → per-member average rating, check-in count, blockers, and a flag for the team member who hasn't checked in at all.

## 10. What I'd do with more time

- **Scheduled jobs** (`iqamaExpiryAlert`, `weeklyPerformanceDigest`) — cut under the time-box per the brief's own cut order. The tiering logic (60/30/14-day urgency) and the aggregation logic (`GetTeamSummary`'s week-over-week math) already exist as interactive tools; a `LuaJob` wrapper that calls them on a cron schedule and pushes proactively via the `Channels` API is the remaining work, not a redesign.
- **Governance hooks for PII redaction.** `LuaAgentConfig.governance` exists in the SDK and isn't used here. Employee wages, Iqama numbers, and phone numbers flow through tool results into the model's context today; a governance policy or postprocessor that redacts or masks sensitive fields before they hit chat history (especially on WhatsApp, which isn't end-to-end auditable the way a controlled web portal is) is a real gap for a 50,000-employee rollout, not a nice-to-have.
- **A KB eval suite.** The refusal-path threshold (0.65) was tuned against two hand-picked queries. A real eval set — a few dozen labelled (query, expected document or expected refusal) pairs run against `search_hr_knowledge` — would catch threshold drift as more documents get added, instead of relying on spot checks.
- **Real BambooHR tenancy** to actually run `BambooHRAdapter` end to end and confirm the two shapes flagged in §4 as inferred rather than confirmed.
- **Approval notifications back through WhatsApp** — right now a manager has to ask "any pending approvals?"; proactively pushing a message when a request lands would close the loop the brief's WhatsApp story implies.
- **Nitaqat/Saudization tracking** — mentioned in the brief's context (industrial conglomerate in KSA) but out of scope for the two chosen workflows; would be a natural third skill.
- **Audit trail** on leave decisions and gratuity calculations — who approved what, when, at what figure — for a process this consequential, the current `decisionNote` field isn't enough on its own.
- **Per-entity orientation scheduling** for new hires across the four countries, referenced in the brief but not part of either chosen workflow.
