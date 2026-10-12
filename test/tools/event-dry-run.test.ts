import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { Construct3ProjectWriter } from '../../src/construct3/project-writer.js';
import { IdGenerator } from '../../src/construct3/id-generator.js';
import { registerEventTools } from '../../src/tools/event-tools.js';
import { MockServer } from '../mocks/mock-server.js';

describe('native event preflight', () => {
  let root: string;
  let reader: Construct3ProjectReader;
  let writer: Construct3ProjectWriter;
  let ids: IdGenerator;
  let server: MockServer;
  const sheetPath = () => join(root, 'eventSheets/MainSheet.json');
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'c3-preflight-'));
    await cp('test/fixtures/minimal-project', root, { recursive: true });
    reader = new Construct3ProjectReader(join(root, 'project.c3proj'));
    await reader.loadProject();
    ids = new IdGenerator();
    writer = new Construct3ProjectWriter(reader, ids);
    server = new MockServer();
    registerEventTools({ server, reader, writer, idGen: ids } as any);
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('preflights a recursive addition without touching disk, cache or live IDs', async () => {
    const original = await readFile(sheetPath(), 'utf8');
    const cached = await reader.readAllEventSheets();
    const before = structuredClone(cached.get('MainSheet'));
    const liveIds = vi.spyOn(ids, 'generateSid');
    const write = vi.spyOn(writer, 'writeEntityFile');
    await writeFile(sheetPath() + '.bak', 'stable existing backup');
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', dryRun: true,
      children: [{ actions: [{ type: 'script', script: 'console.log("native preflight");' }] }] });
    const data = JSON.parse(result.content[0].text);
    expect(data).toMatchObject({ success: true, dryRun: true, wroteFiles: false, validation: { aceContracts: 'not-configured', loadRules: 'passed' } });
    expect(data.generatedSid).toBeUndefined();
    expect(data.editorNote).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
    expect(liveIds).not.toHaveBeenCalled();
    expect(cached.get('MainSheet')).toEqual(before);
    expect(await readFile(sheetPath(), 'utf8')).toBe(original);
    expect(await readFile(sheetPath() + '.bak', 'utf8')).toBe('stable existing backup');
  });

  it('preflights an update with additions without consuming IDs or changing the cached event', async () => {
    const cached = await reader.readAllEventSheets();
    const before = structuredClone(cached.get('MainSheet'));
    const liveIds = vi.spyOn(ids, 'generateSid');
    const result = await server.callTool('update_event_block', { sheetName: 'MainSheet', sid: 400000000000003, dryRun: true,
      updateActions: [{ index: 0, parameters: { x: '120' } }], addActions: [{ type: 'script', script: 'console.log("added");' }] });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0].text)).toMatchObject({ dryRun: true, wroteFiles: false, eventPath: 'events[0]' });
    expect(liveIds).not.toHaveBeenCalled();
    expect(cached.get('MainSheet')).toEqual(before);
    expect(await readdir(join(root, 'eventSheets'))).toEqual(['MainSheet.json']);
  });

  it('runs the same contextual load-rule refusal during a dry run', async () => {
    const before = await readFile(sheetPath(), 'utf8');
    const result = await server.callTool('update_event_block', { sheetName: 'MainSheet', sid: 400000000000003, dryRun: true, updateActions: [{ index: 0, parameters: { x: '' } }] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/empty|expression/i);
    expect(await readFile(sheetPath(), 'utf8')).toBe(before);
  });

  it('rejects a bad configured contract without modifying the sheet', async () => {
    const configured = new MockServer();
    registerEventTools({ server: configured, reader, writer, idGen: ids, knowledge: {
      query: async () => ({ status: 'not-found', reason: 'fixture coverage gap' }),
    } } as any);
    const before = await readFile(sheetPath(), 'utf8');
    const result = await configured.callTool('update_event_block', { sheetName: 'MainSheet', sid: 400000000000003, dryRun: true, updateActions: [{ index: 0, parameters: { x: '120' } }] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No verified');
    expect(await readFile(sheetPath(), 'utf8')).toBe(before);
  });

  it('revalidates and writes the same update when dryRun is false', async () => {
    const before = await readFile(sheetPath(), 'utf8');
    const args = { sheetName: 'MainSheet', sid: 400000000000003, updateActions: [{ index: 0, parameters: { x: '120' } }] };
    await server.callTool('update_event_block', { ...args, dryRun: true });
    expect(await readFile(sheetPath(), 'utf8')).toBe(before);
    const result = await server.callTool('update_event_block', args);
    expect(result.isError).not.toBe(true);
    const sheet = JSON.parse(await readFile(sheetPath(), 'utf8'));
    expect(sheet.events[0].actions[0].parameters).toEqual({ x: '120', y: '200' });
    expect(await readFile(sheetPath() + '.bak', 'utf8')).toBe(before);
  });
});
