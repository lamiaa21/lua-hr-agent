import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { Data } from 'lua-cli';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_DIR = join(__dirname, '..', 'src', 'data', 'kb');
export const KB_COLLECTION = 'hr_knowledge_base';

interface KbFrontmatter {
  title: string;
  country: string;
  category: string;
  lang: 'en' | 'ar';
}

function parseFrontmatter(raw: string): { meta: KbFrontmatter; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Markdown file is missing a --- frontmatter block');
  const meta = yaml.load(match[1]) as KbFrontmatter;
  return { meta, content: match[2].trim() };
}

async function main() {
  const files = readdirSync(KB_DIR).filter((f) => f.endsWith('.md'));
  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const raw = readFileSync(join(KB_DIR, file), 'utf8');
    const { meta, content } = parseFrontmatter(raw);

    const existing = await Data.get(KB_COLLECTION, { title: meta.title, lang: meta.lang }, 1, 1);
    if (existing.data.length > 0) {
      console.log(`Skip (already seeded): ${meta.title} [${meta.lang}]`);
      skipped++;
      continue;
    }

    await Data.create(
      KB_COLLECTION,
      { title: meta.title, country: meta.country, category: meta.category, lang: meta.lang, content },
      `${meta.title}\n\n${content}`,
    );
    console.log(`Seeded: ${meta.title} [${meta.lang}]`);
    created++;
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped} (already present).`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
