import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { Construct3ProjectWriter } from '../../src/construct3/project-writer.js';
import { IdGenerator } from '../../src/construct3/id-generator.js';
import { validateProjectIntegrity } from '../../src/construct3/analyzers/integrity.js';
import { registerEventTools } from '../../src/tools/event-tools.js';
import { registerObjectTools } from '../../src/tools/object-tools.js';
import { registerLayoutTools } from '../../src/tools/layout-tools.js';
import { registerRuntimeTools } from '../../src/tools/runtime-tools.js';
import { MockServer } from '../mocks/mock-server.js';

describe('Tower Defense native authoring regressions', () => {
  let dir: string;
  let reader: Construct3ProjectReader;
  let server: MockServer;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'c3-tower-authoring-'));
    await cp(join(__dirname, '../fixtures/minimal-project'), dir, { recursive: true });
    reader = new Construct3ProjectReader(join(dir, 'project.c3proj'));
    await reader.loadProject();
    const idGen = new IdGenerator();
    const writer = new Construct3ProjectWriter(reader, idGen);
    server = new MockServer();
    const knowledge = { query: async () => ({ status: 'verified', definition: { params: [{ id: 'audio-file', type: 'audiofile' }] } }) };
    const deps = { server, reader, writer, idGen, knowledge } as any;
    registerEventTools(deps);
    registerObjectTools(deps);
    registerLayoutTools(deps);
    registerRuntimeTools(deps);
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function call(name: string, args: Record<string, unknown>) {
    const result = await server.callTool(name, args);
    expect(result.isError, result.content[0].text).not.toBe(true);
    return JSON.parse(result.content[0].text);
  }

  it.each([
    ['create_event_sheet', 'eventSheets', 'MixedEvents'],
    ['create_family', 'families', 'MixedFamily'],
    ['create_object', 'objectTypes', 'MixedSprite'],
  ])('creates %s at the exact registered nested path', async (tool, category, name) => {
    await call(tool, { name, subfolder: 'Logic/Shared', pluginId: 'Sprite' });
    const path = join(dir, category, 'Logic/Shared', `${name}.json`);
    expect(JSON.parse(await readFile(path, 'utf8')).name).toBe(name);
    expect(await reader.getEntityFilePath(category as any, name)).toBe(path);
    expect(await readdir(join(dir, category))).not.toContain(`${name.toLowerCase()}.json`);
  });

  it.each([{ path: 'menu_button' }, 'menu_button'])('writes native audio references from %j with a byte-preserving dry run', async value => {
    await call('create_object', { name: 'Sound', pluginId: 'Audio' });
    const path = await reader.getEntityFilePath('eventSheets', 'MainSheet');
    const before = await readFile(path);
    const args = { sheetName: 'MainSheet', actions: [{ objectClass: 'Sound', id: 'play', parameters: { 'audio-file': value } }] };
    await call('add_event_block', { ...args, dryRun: true });
    expect(await readFile(path)).toEqual(before);
    await call('add_event_block', args);
    const sheet = await reader.readEventSheet('MainSheet');
    expect((sheet.events.at(-1) as any).actions[0].parameters['audio-file']).toEqual({ path: 'menu_button' });
  });

  it.each([{}, { path: 1 }, { path: '../private' }, { path: 'sound', unexpected: true }])('rejects malformed audio %j without writes', async value => {
    await call('create_object', { name: 'Sound', pluginId: 'Audio' });
    const path = await reader.getEntityFilePath('eventSheets', 'MainSheet');
    const before = await readFile(path);
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [{ objectClass: 'Sound', id: 'play', parameters: { 'audio-file': value } }] });
    expect(result.isError).toBe(true);
    expect(await readFile(path)).toEqual(before);
  });

  it('rejects unsupported HTML input enums before writing and detects invalid imported placements', async () => {
    await call('create_object', { name: 'Panel', pluginId: 'HTMLElement' });
    const path = await reader.getEntityFilePath('layouts', 'Layout 1');
    const before = await readFile(path);
    const args = { layoutName: 'Layout 1', layerName: 'Main', objectType: 'Panel', x: 0, y: 0 };
    const result = await server.callTool('add_instance_to_layout', { ...args, properties: { 'stop-input-events': 'yes' } });
    expect(result.isError).toBe(true);
    expect(await readFile(path)).toEqual(before);
    await call('add_instance_to_layout', { ...args, properties: { 'stop-input-events': 'child-elements' } });
    const layout = JSON.parse(await readFile(path, 'utf8'));
    layout.layers[0].instances.at(-1).properties['stop-input-events'] = 'yes';
    await writeFile(path, JSON.stringify(layout));
    const integrity = await validateProjectIntegrity(reader);
    expect(integrity.errors.some(e => e.check === 'plugin-instance-property' && e.message.includes('stop-input-events'))).toBe(true);
  });

  it('packs only engine resources, reports exclusions, and never recursively includes older output', async () => {
    for (const folder of ['.codegraph', 'docs', 'tests', 'test-artifacts']) await mkdir(join(dir, folder));
    for (const name of ['.codegraph/index.db', 'docs/notes.md', 'tests/qa.js', 'test-artifacts/old.c3p', 'AGENTS.md', 'project.c3proj.bak']) {
      await writeFile(join(dir, name), 'private fixture metadata');
    }
    const out = join(dir, 'test-artifacts/current.c3p');
    const first = await call('pack_project', { outputPath: out, injectBridge: false });
    const bytes = await readFile(out);
    expect(first.inventory.included).toContain('project.c3proj');
    expect(first.inventory.excluded.some((entry: any) => entry.path === '.codegraph/')).toBe(true);
    expect(first.inventory.included.some((path: string) => /codegraph|docs|tests|test-artifacts|AGENTS|\.bak/.test(path))).toBe(false);
    expect(bytes.includes(Buffer.from('private fixture metadata'))).toBe(false);
    await call('pack_project', { outputPath: out, injectBridge: false });
    expect(await readFile(out)).toEqual(bytes);
  });

  it('canonicalizes legacy file paths in the archive while retaining the source bytes', async () => {
    const projectPath = reader.getProjectPath();
    const project = JSON.parse(await readFile(projectPath, 'utf8'));
    project.eventSheets = { items: [], subfolders: [{ name: 'Logic', items: ['MainSheet'], subfolders: [] }] };
    await writeFile(projectPath, JSON.stringify(project));
    await reader.loadProject();
    const sheetPath = await reader.getEntityFilePath('eventSheets', 'MainSheet');
    const before = await readFile(sheetPath);
    expect((await validateProjectIntegrity(reader)).warnings.some(w => w.check === 'editor-file-path')).toBe(true);
    const outputPath = join(dir, 'legacy.c3p');
    const packed = await call('pack_project', { outputPath, injectBridge: false });
    expect(packed.inventory.included).toContain('eventSheets/Logic/MainSheet.json');
    const names = JSON.parse(execFileSync('python3', ['-c', 'import zipfile,json,sys;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', outputPath], { encoding: 'utf8' }));
    expect(names).toContain('eventSheets/Logic/MainSheet.json');
    expect(names).not.toContain('eventSheets/MainSheet.json');
    expect(await readFile(sheetPath)).toEqual(before);
  });

  it('refuses to pack through a link that would overwrite a source entity', async () => {
    const path = await reader.getEntityFilePath('eventSheets', 'MainSheet');
    const before = await readFile(path);
    const outputPath = join(dir, 'overwrite.c3p');
    await symlink(path, outputPath);
    const result = await server.callTool('pack_project', { outputPath, injectBridge: false });
    expect(result.isError).toBe(true);
    expect(await readFile(path)).toEqual(before);
  });

  it('keeps script imports and resource dependencies while excluding unregistered source links', async () => {
    await mkdir(join(dir, 'scripts/lib'), { recursive: true });
    await mkdir(join(dir, 'files'));
    await writeFile(join(dir, 'scripts/lib/helper.js'), 'export const value = 1;');
    await writeFile(join(dir, 'files/data.json'), '{}');
    await symlink(join(dir, 'project.c3proj'), join(dir, 'files/unregistered-link'));
    const packed = await call('pack_project', { outputPath: join(dir, 'dependencies.c3p'), injectBridge: false });
    expect(packed.inventory.included).toEqual(expect.arrayContaining(['scripts/lib/helper.js', 'files/data.json']));
    expect(packed.inventory.included).not.toContain('files/unregistered-link');
  });

  it('serializes competing new entity names across different subfolders', async () => {
    const writer = new Construct3ProjectWriter(reader, new IdGenerator());
    const results = await Promise.allSettled(['A', 'B'].map(subfolder =>
      writer.writeEntityFile('eventSheets', 'Competing', { name: 'Competing', events: [] }, subfolder, { createOnly: true })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });

  it('inserts nested function events and edits Copy picked while preserving signatures and SIDs', async () => {
    const path = await reader.getEntityFilePath('eventSheets', 'MainSheet');
    const sheet = await reader.readEventSheet('MainSheet');
    const fn = { eventType: 'function-block', sid: 800, functionName: 'Spawn', functionCopyPicked: false, functionIsAsync: true,
      functionParameters: [{ name: 'Amount', type: 'number', initialValue: '1', sid: 801 }], conditions: [], actions: [], children: [] };
    sheet.events.push(fn as any);
    await writeFile(path, JSON.stringify(sheet));
    const before = await readFile(path);
    const request = { sheetName: 'MainSheet', parentSid: 800, actions: [{ type: 'script', script: 'const amount = localVars.Amount;' }] };
    await call('add_event_block', { ...request, dryRun: true });
    await call('update_event_block', { sheetName: 'MainSheet', sid: 800, functionCopyPicked: true, dryRun: true });
    expect(await readFile(path)).toEqual(before);
    await call('add_event_block', request);
    await call('update_event_block', { sheetName: 'MainSheet', sid: 800, functionCopyPicked: true });
    const saved = (await reader.readEventSheet('MainSheet')).events.at(-1) as any;
    expect(saved).toMatchObject({ ...fn, functionCopyPicked: true, children: expect.any(Array) });
    expect(saved.children).toHaveLength(1);
    expect(saved.children[0].actions[0]).toMatchObject({ type: 'script', script: ['const amount = localVars.Amount;'] });
    expect(saved.children[0].sid).not.toBe(800);
  });
});
