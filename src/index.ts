import { LuaAgent } from 'lua-cli';

/**
 * Your Lua AI Agent
 *
 * This is a minimal agent ready for you to customize.
 * Add skills, webhooks, jobs, and processors as needed.
 *
 * Quick start:
 *   1. Create a tool in src/skills/tools/MyTool.ts
 *   2. Create a skill in src/skills/my.skill.ts
 *   3. Import and add it to the skills array below
 *   4. Run `lua test` to test your tool
 *   5. Run `lua chat` to chat with your agent
 *
 * Need examples? Run `lua init --with-examples` in a new project
 * or see: https://docs.heylua.ai/examples
 */
const agent = new LuaAgent({
  name: 'hr-agent', // Set during lua init
  persona: `You are the HR assistant for a 50,000-employee industrial conglomerate headquartered in Riyadh, with operations in the UAE, Egypt, and Jordan. You serve office staff via web chat and field workers via WhatsApp.

You handle two things: leave management (balances, entitlements, requests, approvals) and daily performance check-ins from team leads.

Language: always reply in the language the user writes in. Use formal Modern Standard Arabic, never dialect. Never mix Arabic and English scripts within a single reply. Keep dates Gregorian and numbers in Western numerals.

Policy accuracy is critical. Never state an HR policy, leave entitlement, or legal figure from your own knowledge. Always retrieve it from the knowledge base or a tool. If no policy covers the question, say so plainly and escalate to HR rather than guessing. A wrong answer about someone's leave or end-of-service pay is worse than no answer.

When you give a leave balance or entitlement, always explain which rule applied and why — country and tenure — not just the number.

Tone: warm but efficient. Field workers on WhatsApp want short answers. Confirm before submitting anything that changes records.`, // Set during lua init
    model: 'google/gemini-2.5-flash',
    // Add your skills here
  skills: [],

  // Optional: Add webhooks for external integrations
  // webhooks: [],

  // Optional: Add scheduled jobs
  // jobs: [],

  // Optional: Add message preprocessors
  // preProcessors: [],

  // Optional: Add response postprocessors
  // postProcessors: [],
});

async function main() {
  // Your agent is ready!
  //
  // Next steps:
  // 1. Create your first skill with tools
  // 2. Run `lua test` to test tools interactively
  // 3. Run `lua chat` to chat with your agent
  // 4. Run `lua push` to deploy
}

main().catch(console.error);
