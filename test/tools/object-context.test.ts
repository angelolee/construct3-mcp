import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { registerQueryTools } from '../../src/tools/query.js';
import { MockServer } from '../mocks/mock-server.js';

describe('native object editing context', () => {
  let root: string;
  let reader: Construct3ProjectReader;
  let server: MockServer;
  const put = async (path: string, value: unknown) => writeFile(join(root, path), JSON.stringify(value));
  const get = async (args: Record<string, unknown> = { name: 'Sprite' }) => {
    expect(server.hasTool('get_object_editing_context')).toBe(true);
    const result = await server.callTool('get_object_editing_context', args);
    return { result, data: result.isError ? undefined : JSON.parse(result.content[0].text) };
  };
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'c3-context-'));
    await cp('test/fixtures/minimal-project', root, { recursive: true });
    const project = JSON.parse(await readFile(join(root, 'project.c3proj'), 'utf8'));
    project.families = { items: ['Actors'], subfolders: [] };
    await put('project.c3proj', project);
    await mkdir(join(root, 'families'));
    await put('families/actors.json', { name: 'Actors', sid: 600, 'plugin-id': 'Sprite', members: ['Sprite'],
      behaviorTypes: [{ name: 'Motion', behaviorId: 'Platform', sid: 601 }], instanceVariables: [{ name: 'Health', type: 'number', sid: 602 }] });
    await put('objectTypes/Sprite.json', { name: 'Sprite', sid: 200, 'plugin-id': 'Sprite',
      behaviorTypes: [{ name: 'SolidWall', behaviorId: 'Solid', sid: 201 }], instanceVariables: [{ name: 'Score', type: 'number', sid: 202 }] });
    await put('layouts/Layout 1.json', { name: 'Layout 1', eventSheet: 'MainSheet', sid: 500,
      layers: [{ name: 'World', sid: 501, instances: [{ type: 'Sprite', uid: 7, sid: 507 }],
        subLayers: [{ name: 'Foreground', sid: 502, instances: [{ type: 'Sprite', uid: 8, sid: 508 }] }] }],
      'nonworld-instances': [{ type: 'Sprite', uid: 9, sid: 509 }] });
    reader = new Construct3ProjectReader(join(root, 'project.c3proj'));
    await reader.loadProject();
    server = new MockServer();
    registerQueryTools(server as any, reader);
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('maps actual own and inherited behavior names to ACE owners', async () => {
    const { data } = await get({ name: 'sprite' });
    expect(data.object).toMatchObject({ name: 'Sprite', category: 'objectTypes', sid: 200, pluginId: 'Sprite', file: 'objectTypes/Sprite.json' });
    expect(data.behaviors.items).toEqual([
      { name: 'SolidWall', addonId: 'Solid', origin: 'Sprite', inherited: false },
      { name: 'Motion', addonId: 'Platform', origin: 'Actors', inherited: true },
    ]);
    expect(data.instanceVariables.items).toEqual([
      { name: 'Score', type: 'number', origin: 'Sprite', inherited: false },
      { name: 'Health', type: 'number', origin: 'Actors', inherited: true },
    ]);
    expect(data.coverage.complete).toBe(true);
    expect(data.editorNote).toBeUndefined();
  });

  it('pages placements including nested layers and non-world entries', async () => {
    const { data } = await get({ name: 'Sprite', limit: 1, placementOffset: 1 });
    expect(data.placements).toMatchObject({ total: 3, nextOffset: 2, items: [{ uid: 8, sid: 508, layout: 'Layout 1', eventSheet: 'MainSheet', layerPath: ['World', 'Foreground'], kind: 'world' }] });
    const last = (await get({ name: 'Actors', limit: 1, placementOffset: 2 })).data;
    expect(last.object.category).toBe('families');
    expect(last.members.items).toEqual(['Sprite']);
    expect(last.placements.items[0]).toMatchObject({ uid: 9, type: 'Sprite', layerPath: [], kind: 'non-world' });
    expect(last.placements.nextOffset).toBeNull();
  });

  it('does not claim completeness when a registered layout or family is unreadable', async () => {
    await writeFile(join(root, 'layouts/Layout 1.json'), '{');
    await writeFile(join(root, 'families/actors.json'), '{');
    const { data } = await get();
    expect(data.coverage.complete).toBe(false);
    expect(data.coverage.unscanned.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: 'layouts', name: 'Layout 1', code: 'E_INVALID_JSON' }),
      expect.objectContaining({ category: 'families', name: 'Actors', code: 'E_INVALID_JSON' }),
    ]));
  });

  it('reports behavior name collisions rather than selecting a contract owner', async () => {
    await put('objectTypes/Sprite.json', { name: 'Sprite', sid: 200, 'plugin-id': 'Sprite', behaviorTypes: [{ name: 'Motion', behaviorId: 'EightDir' }] });
    const { data } = await get();
    expect(data.behaviors.items.map((b: any) => b.addonId)).toEqual(['EightDir', 'Platform']);
    expect(data.warnings.join(' ')).toMatch(/ambiguous.*Motion/i);
  });

  it('refuses object/family naming ambiguity and missing names', async () => {
    expect((await get({ name: 'Missing' })).result.isError).toBe(true);
    const project = reader.getProject();
    project.families.items.push('sprite');
    await put('project.c3proj', project);
    const { result } = await get();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/ambiguous/i);
  });

  it('bounds declarations and reports the omitted portion', async () => {
    await put('objectTypes/Sprite.json', { name: 'Sprite', sid: 200, 'plugin-id': 'Sprite',
      instanceVariables: Array.from({ length: 70 }, (_, i) => ({ name: `Value${i}`, type: 'number' })) });
    const { data } = await get();
    expect(data.instanceVariables.items).toHaveLength(50);
    expect(data.instanceVariables.total).toBe(71);
    expect(data.instanceVariables.truncated).toBe(true);
    expect(data.coverage.complete).toBe(false);
  });

  it('marks malformed present containers and skipped entries as incomplete', async () => {
    await put('objectTypes/Sprite.json', { name: 'Sprite', sid: 200, 'plugin-id': 'Sprite', behaviorTypes: 'bad', instanceVariables: [null] });
    await put('families/actors.json', { name: 'Actors', sid: 600, 'plugin-id': 'Sprite', members: 17 });
    await put('layouts/Layout 1.json', { name: 'Layout 1', sid: 500, layers: {} });
    const { data } = await get();
    expect(data.coverage.complete).toBe(false);
    expect(data.coverage.malformedOrOversizedFields).toBe(true);
  });

  it('does not echo oversized identity values as a complete bounded context', async () => {
    await put('objectTypes/Sprite.json', { name: 'Sprite', sid: 'x'.repeat(1_000_000), 'plugin-id': 'Sprite' });
    await put('layouts/Layout 1.json', { name: 'Layout 1', layers: [{ name: 'Game', instances: [{ type: 'Sprite', uid: { bad: 'y'.repeat(100_000) }, sid: 'z'.repeat(100_000) }] }] });
    const { result, data } = await get();
    expect(result.content[0].text.length).toBeLessThan(128 * 1024);
    expect(data.coverage.complete).toBe(false);
    expect(data.object.sid).toBeNull();
    expect(data.placements.items[0]).toMatchObject({ uid: null, sid: null });
  });
});
