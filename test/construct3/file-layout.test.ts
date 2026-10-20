import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { Construct3ProjectWriter } from '../../src/construct3/project-writer.js';
import { IdGenerator } from '../../src/construct3/id-generator.js';
import { runInToolCall } from '../../src/construct3/disk-state.js';
import { validateProjectIntegrity } from '../../src/construct3/analyzers/integrity.js';
import { resetProjectIndex } from '../../src/construct3/analyzers/index-builder.js';
import { registerEventTools } from '../../src/tools/event-tools.js';
import { registerObjectTools } from '../../src/tools/object-tools.js';
import { registerLayoutTools } from '../../src/tools/layout-tools.js';
import { MockServer } from '../mocks/mock-server.js';

const cases = [
  ['objectTypes', 'Sprite', 'readObjectType'],
  ['eventSheets', 'MainSheet', 'readEventSheet'],
  ['layouts', 'Layout 1', 'readLayout'],
  ['families', 'Enemies', 'readFamily'],
] as const;

describe('Construct folder project file layout', () => {
  let dir: string;
  let reader: Construct3ProjectReader;
  let writer: Construct3ProjectWriter;

  beforeEach(async () => {
    resetProjectIndex();
    dir = await mkdtemp(join(tmpdir(), 'c3-file-layout-'));
    await cp(join(__dirname, '../fixtures/minimal-project'), dir, { recursive: true });
    await mkdir(join(dir, 'families'), { recursive: true });
    await writeFile(join(dir, 'families/Enemies.json'), JSON.stringify({ name: 'Enemies', 'plugin-id': 'Sprite', sid: 99, members: ['Sprite'] }));
    const projectPath = join(dir, 'project.c3proj');
    const project = JSON.parse(await readFile(projectPath, 'utf8'));
    project.families.items = ['Enemies'];
    await writeFile(projectPath, JSON.stringify(project));
    reader = new Construct3ProjectReader(join(dir, 'project.c3proj'));
    writer = new Construct3ProjectWriter(reader, new IdGenerator());
  });

  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it.each(cases)('reads flat lowercase %s files despite virtual folders', async (category, name, method) => {
    await rename(join(dir, category, name + '.json'), join(dir, category, name.toLowerCase() + '.json'));
    const project = JSON.parse(await readFile(join(dir, 'project.c3proj'), 'utf8'));
    project[category] = { items: [], subfolders: [{ name: 'Virtual', items: [name], subfolders: [] }] };
    await writeFile(join(dir, 'project.c3proj'), JSON.stringify(project));
    await reader.loadProject();
    expect((await reader[method](name)).name).toBe(name);
  });

  it('updates and deletes the existing flat file, preserving its backup and virtual folder metadata', async () => {
    const path = join(dir, 'objectTypes/sprite.json');
    await rename(join(dir, 'objectTypes/Sprite.json'), path);
    const original = await readFile(path, 'utf8');
    const project = JSON.parse(await readFile(join(dir, 'project.c3proj'), 'utf8'));
    project.objectTypes = { items: [], subfolders: [{ name: 'Actors', items: ['Sprite'], subfolders: [] }] };
    await writeFile(join(dir, 'project.c3proj'), JSON.stringify(project));
    await reader.loadProject();
    await writer.writeEntityFile('objectTypes', 'Sprite', { ...JSON.parse(original), isGlobal: true }, 'Actors');
    expect(JSON.parse(await readFile(path, 'utf8')).isGlobal).toBe(true);
    expect(await readFile(path + '.bak', 'utf8')).toBe(original);
    expect((await readdir(join(dir, 'objectTypes'))).filter(p => p.endsWith('.json'))).toEqual(['sprite.json']);
    expect(reader.getProject().objectTypes).toEqual(project.objectTypes);
    await writer.deleteEntityFile('objectTypes', 'Sprite', 'Actors');
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(path + '.bak', 'utf8')).isGlobal).toBe(true);
  });

  it('keeps legacy physical subfolder files readable and updates the same file', async () => {
    await mkdir(join(dir, 'objectTypes/Actors'));
    const path = join(dir, 'objectTypes/Actors/Sprite.json');
    await rename(join(dir, 'objectTypes/Sprite.json'), path);
    const project = JSON.parse(await readFile(join(dir, 'project.c3proj'), 'utf8'));
    project.objectTypes = { items: [], subfolders: [{ name: 'Actors', items: ['Sprite'], subfolders: [] }] };
    await writeFile(join(dir, 'project.c3proj'), JSON.stringify(project));
    await reader.loadProject();
    const object = await reader.readObjectType('Sprite');
    await writer.writeEntityFile('objectTypes', 'Sprite', { ...object, isGlobal: true }, 'Actors');
    expect(JSON.parse(await readFile(path, 'utf8')).isGlobal).toBe(true);
    expect((await readdir(join(dir, 'objectTypes'))).filter(p => p.endsWith('.json'))).toEqual([]);
  });

  it('creates new lowercase files at category root while preserving virtual organization', async () => {
    await reader.loadProject();
    await writer.writeEntityFile('eventSheets', 'SharedEvents', { name: 'SharedEvents', sid: 101, events: [] }, 'Logic/Shared');
    await writer.addToProject('eventSheets', 'SharedEvents', 'Logic/Shared');
    expect(JSON.parse(await readFile(join(dir, 'eventSheets/sharedevents.json'), 'utf8')).name).toBe('SharedEvents');
    expect((await reader.readEventSheet('SharedEvents')).sid).toBe(101);
    expect(writer.getSubfolderForEntity('eventSheets', 'SharedEvents')).toBe('Logic/Shared');
  });

  async function moveSpriteToLegacyFolder() {
    await mkdir(join(dir, 'objectTypes/Actors'));
    const path = join(dir, 'objectTypes/Actors/Sprite.json');
    await rename(join(dir, 'objectTypes/Sprite.json'), path);
    const project = JSON.parse(await readFile(join(dir, 'project.c3proj'), 'utf8'));
    project.objectTypes = { items: [], subfolders: [{ name: 'Actors', items: ['Sprite'], subfolders: [] }] };
    await writeFile(join(dir, 'project.c3proj'), JSON.stringify(project));
    await reader.loadProject();
    return path;
  }

  it('refuses to recreate a legacy file deleted externally during the call', async () => {
    const path = await moveSpriteToLegacyFolder();
    await runInToolCall(async () => {
      const object = await reader.readObjectType('Sprite');
      await rm(path);
      await expect(writer.writeEntityFile('objectTypes', 'Sprite', { ...object, isGlobal: true }))
        .rejects.toMatchObject({ code: 'E_STALE_FILE' });
    });
    expect((await readdir(join(dir, 'objectTypes'))).filter(p => p.endsWith('.json'))).toEqual([]);
    expect(await readdir(join(dir, 'objectTypes/Actors'))).toEqual([]);
  });

  it('invalidates legacy cached data when a higher-priority flat file appears', async () => {
    const path = await moveSpriteToLegacyFolder();
    const original = await readFile(path, 'utf8');
    await reader.readAllObjectTypes();
    await writeFile(join(dir, 'objectTypes/sprite.json'), JSON.stringify({ ...JSON.parse(original), isGlobal: true }));
    expect(await reader.syncWithDisk()).toBe(true);
    expect((await reader.readAllObjectTypes()).get('Sprite')!.isGlobal).toBe(true);
    expect(await readFile(path, 'utf8')).toBe(original);
  });

  it('refuses to overwrite a flat file that appeared after a legacy read in the same call', async () => {
    const path = await moveSpriteToLegacyFolder();
    const original = await readFile(path, 'utf8');
    const external = JSON.stringify({ ...JSON.parse(original), isGlobal: true });
    const flat = join(dir, 'objectTypes/sprite.json');
    await runInToolCall(async () => {
      const object = await reader.readObjectType('Sprite');
      await writeFile(flat, external);
      await expect(writer.writeEntityFile('objectTypes', 'Sprite', object)).rejects.toMatchObject({ code: 'E_STALE_FILE' });
    });
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await readFile(flat, 'utf8')).toBe(external);
  });

  it('keeps missing flat-file dependencies when parallel calls refresh a legacy bulk cache', async () => {
    const legacy = await moveSpriteToLegacyFolder();
    const original = await readFile(legacy, 'utf8');
    await reader.readAllObjectTypes();
    let ready!: () => void;
    let resume!: () => void;
    const cachedRead = new Promise<void>(resolve => { ready = resolve; });
    const refreshed = new Promise<void>(resolve => { resume = resolve; });
    const firstCall = runInToolCall(async () => {
      const object = (await reader.readAllObjectTypes()).get('Sprite')!;
      ready();
      await refreshed;
      await expect(writer.writeEntityFile('objectTypes', 'Sprite', object)).rejects.toMatchObject({ code: 'E_STALE_FILE' });
    });
    await cachedRead;
    const flat = join(dir, 'objectTypes/sprite.json');
    const external = JSON.stringify({ ...JSON.parse(original), isGlobal: true });
    await writeFile(flat, external);
    await runInToolCall(async () => {
      expect((await reader.readAllObjectTypes()).get('Sprite')!.isGlobal).toBe(true);
    });
    resume();
    await firstCall;
    expect(await readFile(flat, 'utf8')).toBe(external);
    expect(await readFile(legacy, 'utf8')).toBe(original);
  });

  it('does not hide malformed flat files by falling back to legacy folders', async () => {
    await mkdir(join(dir, 'objectTypes/Actors'));
    await cp(join(dir, 'objectTypes/Sprite.json'), join(dir, 'objectTypes/Actors/Sprite.json'));
    await writeFile(join(dir, 'objectTypes/Sprite.json'), 'invalid JSON');
    const project = JSON.parse(await readFile(join(dir, 'project.c3proj'), 'utf8'));
    project.objectTypes = { items: [], subfolders: [{ name: 'Actors', items: ['Sprite'], subfolders: [] }] };
    await writeFile(join(dir, 'project.c3proj'), JSON.stringify(project));
    await reader.loadProject();
    await expect(reader.readObjectType('Sprite')).rejects.toThrow('Failed to read object type');
  });

  it('rejects escaping subfolder arguments even when a flat file exists', async () => {
    await reader.loadProject();
    await expect(writer.writeEntityFile('objectTypes', 'Sprite', { name: 'Sprite' }, '../../../outside')).rejects.toThrow('Path traversal');
  });

  it.each([
    ['objectTypes', 'Sprite', 'create_object'],
    ['eventSheets', 'MainSheet', 'create_event_sheet'],
    ['layouts', 'Layout 1', 'create_layout'],
    ['families', 'Enemies', 'create_family'],
  ] as const)('rejects case-insensitive %s creation collisions before side effects', async (category, name, tool) => {
    const projectPath = join(dir, 'project.c3proj');
    const project = JSON.parse(await readFile(projectPath, 'utf8'));
    project.families.items = ['Enemies'];
    await writeFile(projectPath, JSON.stringify(project));
    await reader.loadProject();
    const originalPath = await reader.getEntityFilePath(category, name);
    const originalFile = await readFile(originalPath, 'utf8');
    const originalProject = await readFile(projectPath, 'utf8');
    const server = new MockServer();
    const deps = { server, reader, writer, idGen: new IdGenerator() } as any;
    registerEventTools(deps);
    registerObjectTools(deps);
    registerLayoutTools(deps);
    const result = await server.callTool(tool, { name: name.toUpperCase(), pluginId: 'Sprite' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/already exists|already used|differs only in case/);
    expect(await readFile(originalPath, 'utf8')).toBe(originalFile);
    expect(await readFile(projectPath, 'utf8')).toBe(originalProject);
    expect(await readdir(join(dir, category))).not.toContain(name.toLowerCase() + '.json.bak');
  });

  it('recognizes lowercase registered files and still reports genuine orphan files', async () => {
    await rename(join(dir, 'objectTypes/Sprite.json'), join(dir, 'objectTypes/sprite.json'));
    await writeFile(join(dir, 'objectTypes/Unregistered.json'), '{}');
    await reader.loadProject();
    const result = await validateProjectIntegrity(reader);
    expect(result.info.filter(i => i.check === 'orphaned-file').map(i => i.entity)).toEqual(['objectTypes/Unregistered.json']);
  });

  it('excludes Editor UI state from orphan entity findings', async () => {
    await mkdir(join(dir, 'layouts/uistate'));
    await writeFile(join(dir, 'layouts/uistate/Layout 1.instancesBar.json'), '{}');
    await writeFile(join(dir, 'layouts/Layout 1.uistate.json'), '{}');
    await reader.loadProject();
    const result = await validateProjectIntegrity(reader);
    expect(result.info.filter(i => i.check === 'orphaned-file')).toEqual([]);
  });

  it('recognizes nested registered files and reports same-named unused physical copies', async () => {
    await mkdir(join(dir, 'objectTypes/Actors/Enemies'), { recursive: true });
    await rename(join(dir, 'objectTypes/Sprite.json'), join(dir, 'objectTypes/Actors/Enemies/sprite.json'));
    await mkdir(join(dir, 'objectTypes/Unused'));
    await writeFile(join(dir, 'objectTypes/Unused/Sprite.json'), '{}');
    const project = JSON.parse(await readFile(join(dir, 'project.c3proj'), 'utf8'));
    project.objectTypes = { items: [], subfolders: [{ name: 'Actors', items: [], subfolders: [{ name: 'Enemies', items: ['Sprite'], subfolders: [] }] }] };
    await writeFile(join(dir, 'project.c3proj'), JSON.stringify(project));
    await reader.loadProject();
    const result = await validateProjectIntegrity(reader);
    expect(result.info.filter(i => i.check === 'orphaned-file').map(i => i.entity)).toEqual(['objectTypes/Unused/Sprite.json']);
  });
});
