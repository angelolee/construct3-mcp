import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import type { KnowledgeBase } from './base.js';

const line = z.string().min(1).max(1200);
const lines = z.array(line).max(15);
const contractRef = z.object({ ownerType: z.enum(['plugin', 'behavior', 'common']), owner: z.string().min(1).max(100), kind: z.enum(['conditions', 'actions', 'expressions']), id: z.string().min(1).max(200) }).strict();
const recipeSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), title: z.string().min(1).max(200), summary: z.string().min(1).max(600),
  tags: z.array(z.string().min(1).max(100)).max(20), prerequisites: lines, steps: lines, pitfalls: lines, acceptance: lines, limitations: lines,
  evidence: z.array(z.object({ kind: z.enum(['manual', 'structural', 'contract', 'editor-runtime']), reference: line, scope: line }).strict()).max(12),
  contractRefs: z.array(contractRef).max(8),
}).strict();
const catalogSchema = z.object({ schemaVersion: z.literal(1), snapshotRelease: z.string().min(1).max(40), recipes: z.array(recipeSchema).max(50) }).strict();
const MAX_CATALOG_BYTES = 256 * 1024;

export class RecipeCatalog {
  constructor(private knowledge: KnowledgeBase) {}

  private async read() {
    const root = await realpath(this.knowledge.root);
    const path = await realpath(join(root, 'data', 'recipes', 'catalog.json'));
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Recipe catalog must remain inside the configured knowledge root');
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_CATALOG_BYTES) throw new Error('Recipe catalog must be a file no larger than 256 KiB');
    const bytes = await readFile(path);
    if (bytes.length > MAX_CATALOG_BYTES) throw new Error('Recipe catalog exceeds 256 KiB');
    const data = catalogSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (new Set(data.recipes.map(r => r.id)).size !== data.recipes.length) throw new Error('Duplicate recipe IDs in catalog');
    return { data, catalog: { schemaVersion: data.schemaVersion, snapshotRelease: data.snapshotRelease, sha256: createHash('sha256').update(bytes).digest('hex') } };
  }

  async search(query: string, limit: number) {
    const { data, catalog } = await this.read();
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = data.recipes.filter(r => words.every(word => `${r.id} ${r.title} ${r.summary} ${r.tags.join(' ')}`.toLowerCase().includes(word)));
    return { catalog, total: matches.length, results: matches.slice(0, limit).map(({ id, title, summary, tags }) => ({ id, title, summary, tags })) };
  }

  async get(id: string) {
    const { data, catalog } = await this.read();
    const recipe = data.recipes.find(r => r.id === id);
    if (!recipe) throw new Error(`Unknown recipe "${id}". Use search_construct_recipes.`);
    const contracts = await Promise.all(recipe.contractRefs.map(async ref => {
      try {
        const contract = await this.knowledge.query({ operation: 'get_ace_contract', ...ref });
        return { reference: ref, matchesSnapshot: contract.status === 'verified' && contract.source?.release === data.snapshotRelease, contract };
      } catch (error) {
        return { reference: ref, matchesSnapshot: false, contract: { status: 'unverified', reason: error instanceof Error ? error.message : String(error) } };
      }
    }));
    const result = { status: contracts.every(c => c.matchesSnapshot) ? 'ready' : 'coverage-gap', catalog, recipe, contracts,
      bindingNote: 'Recipe contracts use example addon IDs, not actual project bindings. Resolve objectClass and behaviorType using get_object_editing_context. Ready describes contract retrieval only; follow scoped acceptance and limitations.' };
    if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw new Error('Recipe with contract responses exceeds 128 KiB; retrieve individual contracts instead');
    return result;
  }
}
