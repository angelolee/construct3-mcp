import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerKnowledgeTools } from '../../src/tools/knowledge-tools.js';
import { MockServer } from '../mocks/mock-server.js';

describe('structural recipe retrieval', () => {
  let root: string;
  let server: MockServer;
  let catalog: any;
  let contract: any;
  const save = () => writeFile(join(root, 'data/recipes/catalog.json'), JSON.stringify(catalog));
  const get = async (tool: string, args: Record<string, unknown>) => {
    expect(server.hasTool(tool)).toBe(true);
    return server.callTool(tool, args);
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'c3-recipes-'));
    await mkdir(join(root, 'data/recipes'), { recursive: true });
    catalog = { schemaVersion: 1, snapshotRelease: 'r495.2', recipes: [{ id: 'edit-native-events', title: 'Edit native events',
      summary: 'Resolve behavior names before changing JSON.', tags: ['structure', 'behavior'], prerequisites: ['Read the target sheet.'],
      steps: ['Resolve the actual behaviorType with get_object_editing_context.'], pitfalls: ['Addon IDs are not instance names.'],
      acceptance: ['Preflight then apply and preview.'], evidence: [{ kind: 'structural', reference: 'official-examples/template-platformer', scope: 'one copied template' }],
      limitations: ['Does not prove all picking semantics.'], contractRefs: [{ ownerType: 'behavior', owner: 'Platform', kind: 'actions', id: 'simulate-control' }] }] };
    await save();
    contract = { status: 'verified', definition: { id: 'simulate-control', params: [{ id: 'control', type: 'combo', items: ['left', 'right', 'jump'] }] }, source: { url: 'https://example.test/aces', sha256: 'test-hash', release: 'r495.2' } };
    server = new MockServer();
    registerKnowledgeTools(server as any, { root, query: async () => contract } as any);
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('searches plain words and returns bounded summaries without entire instructions', async () => {
    catalog.recipes.push({ ...catalog.recipes[0], id: 'other', title: 'Other behavior recipe' });
    await save();
    const result = await get('search_construct_recipes', { query: 'BEHAVIOR', limit: 1 });
    const data = JSON.parse(result.content[0].text);
    expect(data.results).toHaveLength(1);
    expect(data.total).toBe(2);
    expect(data.results[0].steps).toBeUndefined();
    expect(data.catalog.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns exact contract parameters while keeping proof scoped to the recipe', async () => {
    const result = await get('get_construct_recipe', { id: 'edit-native-events' });
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('ready');
    expect(data.contracts[0]).toMatchObject({ matchesSnapshot: true, contract: { status: 'verified', definition: { params: [{ id: 'control', type: 'combo', items: ['left', 'right', 'jump'] }] } } });
    expect(data.recipe.evidence[0].scope).toBe('one copied template');
  });

  it.each(['missing-contract', 'wrong-release'])('exposes %s as a coverage gap', async (mode) => {
    contract = mode === 'missing-contract' ? { status: 'unverified', reason: 'owner coverage missing' } : { ...contract, source: { ...contract.source, release: 'r500' } };
    const data = JSON.parse((await get('get_construct_recipe', { id: 'edit-native-events' })).content[0].text);
    expect(data.status).toBe('coverage-gap');
    expect(data.contracts[0].matchesSnapshot).toBe(false);
  });

  it('does not guess a recipe ID', async () => {
    expect((await get('get_construct_recipe', { id: 'missing' })).isError).toBe(true);
  });

  it.each(['missing', 'corrupt', 'duplicate', 'oversized'])('refuses a %s catalog', async (mode) => {
    const path = join(root, 'data/recipes/catalog.json');
    if (mode === 'missing') await rm(path);
    if (mode === 'corrupt') await writeFile(path, '{');
    if (mode === 'duplicate') { catalog.recipes.push(catalog.recipes[0]); await save(); }
    if (mode === 'oversized') await writeFile(path, ' '.repeat(270_000));
    const result = await get('search_construct_recipes', { query: 'behavior' });
    expect(result.isError).toBe(true);
  });
});
