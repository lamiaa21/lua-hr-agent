import { z } from 'zod';
import { Data, type LuaTool } from 'lua-cli';

const KB_COLLECTION = 'hr_knowledge_base';
/** Below this similarity score, treat the match as noise rather than a real answer. */
const RELEVANCE_THRESHOLD = 0.65;

export class SearchHRKnowledge implements LuaTool {
  name = 'search_hr_knowledge';
  description = 'Search HR policies and SOPs (leave, gratuity, probation, Iqama, salary certificates, exit/re-entry visas, public holidays). Always cite the returned title. If nothing relevant comes back, say so plainly instead of guessing.';
  inputSchema = z.object({
    query: z.string().describe('What the employee wants to know, in their own words.'),
    lang: z.enum(['en', 'ar']).optional().describe('Prefer documents in this language if available.'),
  });

  async execute(input: z.infer<typeof this.inputSchema>) {
    const results = await Data.search(KB_COLLECTION, input.query, 5, RELEVANCE_THRESHOLD);
    const preferred = input.lang ? results.filter((r) => r.data.lang === input.lang) : results;
    const matches = preferred.length > 0 ? preferred : results;

    if (matches.length === 0) {
      return {
        found: false,
        message:
          'No matching HR policy or SOP found in the knowledge base for this question. Do not answer from your own knowledge — tell the user this isn\'t covered and suggest they escalate to HR.',
      };
    }

    return {
      found: true,
      results: matches.slice(0, 3).map((r) => ({
        title: r.data.title,
        category: r.data.category,
        country: r.data.country,
        lang: r.data.lang,
        content: r.data.content,
        relevance: r.score,
      })),
    };
  }
}
