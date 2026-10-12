import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeBase } from '../../src/knowledge/base.js';
import { registerKnowledgeTools } from '../../src/tools/knowledge-tools.js';
import { MockServer } from '../mocks/mock-server.js';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { Construct3ProjectWriter } from '../../src/construct3/project-writer.js';
import { IdGenerator } from '../../src/construct3/id-generator.js';
import { registerEventTools } from '../../src/tools/event-tools.js';
import { resetProjectIndex } from '../../src/construct3/analyzers/index-builder.js';

export async function createKnowledgeFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'c3-knowledge-'));
  const setup = `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1])
c.executescript('''
CREATE TABLE sources(id TEXT,url TEXT,sha256 TEXT,license TEXT);
CREATE TABLE pages(id TEXT,source TEXT,page INTEGER,title TEXT,url TEXT,text TEXT);
CREATE VIRTUAL TABLE page_search USING fts5(id UNINDEXED,title,text);
CREATE TABLE examples(slug TEXT,metadata TEXT);
CREATE TABLE aces(owner_type TEXT,owner TEXT,kind TEXT,id TEXT,category TEXT,definition TEXT);
CREATE TABLE observed_aces(owner_type TEXT,owner TEXT,kind TEXT,id TEXT,metadata TEXT);
''')
for s in ['construct-3','plugins-allAces-r495-2','behaviors-allAces-r495-2','common-aces-r495-2']:
 c.execute('INSERT INTO sources VALUES(?,?,?,?)',(s,'https://example.test/r495-2/'+s,'test-hash','test-only'))
c.execute('INSERT INTO pages VALUES(?,?,?,?,?,?)',('manual:1','construct-3',1,'Picking instances','https://example.test/picking','Picked instances select objects. '*200))
c.execute('INSERT INTO page_search VALUES(?,?,?)',('manual:1','Picking instances','Picked instances select objects. '*200))
examples=[('platformer',{'name':'Platformer','catalog':{'tags':['platformer','barebones-template']},'addons':[{'type':'behavior','id':'Platform'}]}),('command-test',{'name':'External Command','catalog':{'projectUrl':'https://github.com/AshleyScirra/CommandAndConstruct'},'addons':[]}),('shooter',{'name':'Shooter','catalog':{'tags':['shooter']},'addons':[{'type':'behavior','id':'Bullet'}]})]
for slug,m in examples:c.execute('INSERT INTO examples VALUES(?,?)',(slug,json.dumps(m)))
aces=[('behavior','Platform','actions','set-max-speed',[{'id':'max-speed','type':'number'}]),('behavior','Platform','actions','simulate-control',[{'id':'control','type':'combo','items':['left','right','jump']}]),('plugin','system','actions','go-to-layout',[{'id':'layout','type':'layout'}]),('plugin','system','actions','unsupported-test',[{'id':'value','type':'variadic'}]),('plugin','Text','actions','set-text',[{'id':'text','type':'string'}]),('common','builtin','actions','set-position',[{'id':'x','type':'number'},{'id':'y','type':'number'}])]
aces += [('plugin','system','actions','map-function',[{'id':'name','type':'string'},{'id':'string','type':'string'},{'id':'function','type':'function'}]),('plugin','system','actions','set-function-return-value',[{'id':'value','type':'any'}])]
for t,o,k,i,p in aces:c.execute('INSERT INTO aces VALUES(?,?,?,?,?,?)',(t,o,k,i,'test',json.dumps({'id':i,'params':p})))
c.execute('INSERT INTO observed_aces VALUES(?,?,?,?,?)',('plugin','Sprite','actions','set-position','{}'))
c.commit()
`;
  execFileSync('python3', ['-c', setup, join(root, 'knowledge.sqlite')]);
  return root;
}

describe('Construct knowledge tools', () => {
  let root: string;
  let knowledge: KnowledgeBase;
  let server: MockServer;
  beforeEach(async () => {
    root = await createKnowledgeFixture();
    knowledge = new KnowledgeBase(root);
    server = new MockServer();
    registerKnowledgeTools(server as any, knowledge);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('returns bounded documentation with stable source attribution', async () => {
    const result = await server.callTool('search_construct_docs', { query: 'picked instances', limit: 1 });
    expect(result.isError).not.toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({ id: 'manual:1', page: 1, url: 'https://example.test/picking', sourceHash: 'test-hash' });
    expect(data.results[0].text.length).toBeLessThanOrEqual(1800);
  });

  it('filters examples by mechanic and addon without returning entire inventories', async () => {
    const result = await server.callTool('search_construct_examples', { query: 'platformer', addonId: 'Platform' });
    const data = JSON.parse(result.content[0].text);
    expect(data.results.map((r: any) => r.slug)).toEqual(['platformer']);
    expect(data.results[0].status.runtimeTest).toBe('unknown');
  });

  it('preserves an external example source URL', async () => {
    const result = await server.callTool('search_construct_examples', { query: 'External Command' });
    expect(JSON.parse(result.content[0].text).results[0].url).toBe('https://github.com/AshleyScirra/CommandAndConstruct');
  });

  it('returns an exact direct ACE contract and source release', async () => {
    const result = await server.callTool('get_ace_contract', { ownerType: 'behavior', owner: 'Platform', kind: 'actions', id: 'set-max-speed' });
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('verified');
    expect(data.definition.params[0].id).toBe('max-speed');
    expect(data.source.release).toBe('r495.2');
  });

  it('distinguishes observed common applicability from a direct contract', async () => {
    const data = await knowledge.query({ operation: 'get_ace_contract', ownerType: 'plugin', owner: 'Sprite', kind: 'actions', id: 'set-position' });
    expect(data.status).toBe('verified');
    expect(data.evidence).toBe('common-contract-with-observed-owner');
    expect(data.definition.params.map((p: any) => p.id)).toEqual(['x', 'y']);
  });

  it('does not assume a common ACE is available on an unobserved plugin', async () => {
    const data = await knowledge.query({ operation: 'get_ace_contract', ownerType: 'plugin', owner: 'Text', kind: 'actions', id: 'set-position' });
    expect(data.status).toBe('unverified');
    expect(data.reason).toContain('applicability');
  });

  it('reports a known behavior missing an ACE separately from unknown owners', async () => {
    const data = await knowledge.query({ operation: 'get_ace_contract', ownerType: 'behavior', owner: 'Platform', kind: 'actions', id: 'nonexistent' });
    expect(data.status).toBe('not-found');
    expect(data.knownOwner).toBe(true);
  });

  it('turns invalid FTS syntax into a useful tool error', async () => {
    const result = await server.callTool('search_construct_docs', { query: '"' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Knowledge query failed');
  });

  it('does not interpolate source identifiers into SQL', async () => {
    const data = await knowledge.query({ operation: 'get_ace_contract', ownerType: 'plugin', owner: "Text' OR 1=1 --", kind: 'actions', id: 'set-text' });
    expect(data.status).toBe('unverified');
    expect(data.knownOwner).toBe(false);
  });

  it('rejects missing databases without creating an empty database', async () => {
    const missing = new KnowledgeBase(join(root, 'missing'));
    await expect(missing.query({ operation: 'search_docs', query: 'picking' })).rejects.toThrow('Knowledge query failed');
  });

  it('reports an unavailable Python runtime explicitly', async () => {
    const missing = new KnowledgeBase(root, '/nonexistent/c3-python');
    await expect(missing.query({ operation: 'search_docs', query: 'picking' })).rejects.toThrow('Knowledge query failed');
  });


  it('rejects incomplete, mismatched and corrupt provider responses', async () => {
    const fake = join(root, 'fake-provider.py');
    const fakeRuntime = join(root, 'fake-python');
    const { chmod } = await import('node:fs/promises');
    await writeFile(fakeRuntime, '#!/bin/sh\nexec python3 "' + fake + '"\n');
    await chmod(fakeRuntime, 0o700);
    const broken = new KnowledgeBase(root, fakeRuntime);
    for (const output of [{}, { status: 'verified', definition: { id: 'different', params: [] }, evidence: 'test', source: { id: 'test', url: 'https://example.test', hash: 'test' } }, { status: 'verified', definition: { id: 'set-text', params: [{ id: 'text', type: 'corrupt' }] }, evidence: 'test', source: { id: 'test', url: 'https://example.test', hash: 'test' } }]) {
      await writeFile(fake, 'print(' + JSON.stringify(JSON.stringify(output)) + ')');
      await expect(broken.query({ operation: 'get_ace_contract', ownerType: 'plugin', owner: 'Text', kind: 'actions', id: 'set-text' })).rejects.toThrow('Knowledge query failed');
    }
    await writeFile(fake, "print('{}')");
    await expect(broken.query({ operation: 'search_docs', query: 'picked' })).rejects.toThrow('Knowledge query failed');
  });

  it('enforces response bounds at the tool boundary', async () => {
    await expect(server.callTool('search_construct_docs', { query: 'picking', limit: 10000 })).rejects.toThrow();
  });
});

describe('Configured pre-write event contract validation', () => {
  let root: string;
  let projectDir: string;
  let reader: Construct3ProjectReader;
  let writer: Construct3ProjectWriter;
  let server: MockServer;
  let knowledge: KnowledgeBase;
  let sheetPath: string;
  beforeEach(async () => {
    resetProjectIndex();
    root = await createKnowledgeFixture();
    projectDir = join(root, 'project');
    await cp(join(__dirname, '../fixtures/minimal-project'), projectDir, { recursive: true });
    const objectPath = join(projectDir, 'objectTypes/Sprite.json');
    const object = JSON.parse(await readFile(objectPath, 'utf8'));
    object.behaviorTypes = [{ name: 'Movement', behaviorId: 'Platform', sid: 700 }];
    await writeFile(objectPath, JSON.stringify(object));
    reader = new Construct3ProjectReader(join(projectDir, 'project.c3proj'));
    await reader.loadProject();
    const idGen = new IdGenerator();
    writer = new Construct3ProjectWriter(reader, idGen);
    knowledge = new KnowledgeBase(root);
    server = new MockServer();
    registerEventTools({ server, reader, writer, idGen, knowledge } as any);
    sheetPath = await reader.getEntityFilePath('eventSheets', 'MainSheet');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  const movement = (parameters: Record<string, unknown> = { 'max-speed': '330' }) => ({
    id: 'set-max-speed', objectClass: 'Sprite', behaviorType: 'Movement', parameters,
  });

  async function rejectsWithoutWrite(action: Record<string, unknown>, expected: string) {
    const original = await readFile(sheetPath, 'utf8');
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [action] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(expected);
    expect(await readFile(sheetPath, 'utf8')).toBe(original);
  }

  it('rejects a nonexistent action on a known behavior owner', async () => {
    await rejectsWithoutWrite({ ...movement(), id: 'nonexistent' }, 'nonexistent');
  });
  it('rejects an addon ID used instead of the actual behavior instance name', async () => {
    await rejectsWithoutWrite({ ...movement(), behaviorType: 'Platform' }, 'behavior instance');
  });
  it('rejects missing required parameters', async () => {
    await rejectsWithoutWrite(movement({}), 'max-speed');
  });
  it('rejects unknown parameter keys', async () => {
    await rejectsWithoutWrite(movement({ 'max-speed': '330', typo: '1' }), 'typo');
  });
  it('accepts the actual behavior instance with a verified addon contract', async () => {
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [movement()] });
    expect(result.isError).not.toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.warnings?.some((w: string) => w.includes('was not validated'))).not.toBe(true);
  });
  it('preserves comment and script rows alongside verified ACEs and nested non-ACE events', async () => {
    const result = await server.callTool('add_event_block', {
      sheetName: 'MainSheet',
      actions: [{ type: 'comment', text: 'Movement tuning' }, { type: 'script', script: ['console.log("ready");'] }, movement()],
      children: [{ eventType: 'comment', text: 'Child note' }, { eventType: 'script', script: ['console.log("child");'] }],
    });
    expect(result.isError).not.toBe(true);
    const block = JSON.parse(await readFile(sheetPath, 'utf8')).events.at(-1);
    expect(block.actions[0]).toMatchObject({ type: 'comment', text: 'Movement tuning' });
    expect(block.actions[1]).toMatchObject({ type: 'script', script: ['console.log("ready");'] });
    expect(block.actions[2].id).toBe('set-max-speed');
    expect(block.children.map((child: any) => child.eventType)).toEqual(['comment', 'script']);
  });
  it('accepts a common contract whose owner applicability was observed', async () => {
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [{ id: 'set-position', objectClass: 'Sprite', parameters: { x: '10', y: '20' } }] });
    expect(result.isError).not.toBe(true);
  });
  it('resolves behavior instances inherited from a family', async () => {
    await mkdir(join(projectDir, 'families'));
    await writeFile(join(projectDir, 'families/movingactors.json'), JSON.stringify({ name: 'MovingActors', 'plugin-id': 'Sprite', sid: 800, members: ['Sprite'], behaviorTypes: [{ name: 'InheritedMovement', behaviorId: 'Platform', sid: 801 }] }));
    await writer.addToProject('families', 'MovingActors');
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [{ ...movement(), behaviorType: 'InheritedMovement' }] });
    expect(result.isError).not.toBe(true);
  });
  it('rejects an invalid recursive child before writing any event', async () => {
    const original = await readFile(sheetPath, 'utf8');
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', children: [{ actions: [{ ...movement(), id: 'nonexistent' }] }] });
    expect(result.isError).toBe(true);
    expect(await readFile(sheetPath, 'utf8')).toBe(original);
  });
  it('validates merged parameter updates and preserves the original file on failure', async () => {
    await writer.writeEntityFile('eventSheets', 'MainSheet', { name: 'MainSheet', sid: 100, events: [{ eventType: 'block', sid: 900, conditions: [], actions: [{ ...movement(), sid: 901 }] }] });
    const original = await readFile(sheetPath, 'utf8');
    const result = await server.callTool('update_event_block', { sheetName: 'MainSheet', sid: 900, updateActions: [{ index: 0, parameters: { typo: '2' } }] });
    expect(result.isError).toBe(true);
    expect(await readFile(sheetPath, 'utf8')).toBe(original);
  });

  it('writes canonical combo strings from official project representations', async () => {
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [{ ...movement({ control: 'left' }), id: 'simulate-control' }] });
    expect(result.isError).not.toBe(true);
    const sheet = JSON.parse(await readFile(sheetPath, 'utf8'));
    expect(sheet.events.at(-1).actions[0].parameters.control).toBe('left');
  });
  it('rejects numeric and unknown combo inputs before writing', async () => {
    for (const control of [0, 'sideways']) await rejectsWithoutWrite({ ...movement({ control }), id: 'simulate-control' }, 'combo');
  });
  it('rejects malformed references and unsupported parameter contracts', async () => {
    await rejectsWithoutWrite({ id: 'go-to-layout', objectClass: 'System', parameters: { layout: { bogus: true } } }, 'layout');
    await rejectsWithoutWrite({ id: 'unsupported-test', objectClass: 'System', parameters: { value: {} } }, 'Unsupported parameter type');
  });
  it('supports canonical function calls and validates ordered arguments', async () => {
    await writer.writeEntityFile('eventSheets', 'MainSheet', { name: 'MainSheet', events: [{ eventType: 'function-block', functionName: 'Reset', functionParameters: [{ name: 'amount', type: 'number' }], conditions: [], actions: [], sid: 900 }] });
    resetProjectIndex();
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [{ callFunction: 'Reset', parameters: ['10'] }] });
    expect(result.isError).not.toBe(true);
    const sheet = JSON.parse(await readFile(sheetPath, 'utf8'));
    expect(sheet.events.at(-1).actions[0]).toMatchObject({ callFunction: 'Reset', parameters: ['10'] });
    expect(sheet.events.at(-1).actions[0].objectClass).toBeUndefined();
    await rejectsWithoutWrite({ id: 'not-an-action', objectClass: 'Sprite', behaviorType: 'Ghost', callFunction: 'Reset', parameters: {} }, 'Function call');
    const before = await readFile(sheetPath, 'utf8');
    const invalid = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [{ callFunction: 'Reset', parameters: [] }] });
    expect(invalid.isError).toBe(true);
    expect(await readFile(sheetPath, 'utf8')).toBe(before);
  });

  async function writeBooleanFunction() {
    await writer.writeEntityFile('eventSheets', 'MainSheet', {
      name: 'MainSheet', events: [
        { eventType: 'function-block', functionName: 'Reset', functionParameters: [{ name: 'enabled', type: 'boolean', sid: 902 }], conditions: [], actions: [], sid: 900 },
        { eventType: 'block', conditions: [], actions: [{ callFunction: 'Reset', parameters: [true], sid: 903 }], sid: 901 },
      ],
    });
  }

  it('accepts canonical boolean function arguments and upstream spelling normalization', async () => {
    await writeBooleanFunction();
    const added = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [{ callFunction: 'reset', parameters: [true] }] });
    expect(added.isError).not.toBe(true);
    expect(JSON.parse(await readFile(sheetPath, 'utf8')).events.at(-1).actions[0]).toMatchObject({ callFunction: 'Reset', parameters: [true] });
    const updated = await server.callTool('update_event_block', { sheetName: 'MainSheet', sid: 901, updateActions: [{ index: 0, parameters: [false] }] });
    expect(updated.isError).not.toBe(true);
    expect(JSON.parse(await readFile(sheetPath, 'utf8')).events[1].actions[0].parameters).toEqual([false]);
  });

  it('checks surviving function-call edits and keeps the file unchanged on arity or representation errors', async () => {
    await writeBooleanFunction();
    const original = await readFile(sheetPath, 'utf8');
    for (const parameters of [[], ['true']]) {
      const result = await server.callTool('update_event_block', { sheetName: 'MainSheet', sid: 901, updateActions: [{ index: 0, parameters }] });
      expect(result.isError).toBe(true);
      expect(await readFile(sheetPath, 'utf8')).toBe(original);
    }
    await rejectsWithoutWrite({ callFunction: 'Reset', parameters: ['true'] }, 'boolean');
    const removed = await server.callTool('update_event_block', {
      sheetName: 'MainSheet', sid: 901, updateActions: [{ index: 0, parameters: [] }], removeActionIndices: [0],
    });
    expect(removed.isError).not.toBe(true);
    expect(JSON.parse(await readFile(sheetPath, 'utf8')).events[1].actions).toEqual([]);
  });

  it.each(['Functions', 'Fn'])('validates the built-in %s namespace using System contracts', async name => {
    await writeBooleanFunction();
    if (name !== 'Functions') {
      const projectPath = join(projectDir, 'project.c3proj');
      const project = JSON.parse(await readFile(projectPath, 'utf8'));
      project.functionsName = name;
      await writeFile(projectPath, JSON.stringify(project));
    }
    const mapped = await server.callTool('add_event_block', {
      sheetName: 'MainSheet', actions: [{ id: 'map-function', objectClass: name, parameters: { name: '"ResetMap"', string: '"reset"', function: 'Reset' } }],
    });
    expect(mapped.isError).not.toBe(true);
    const returned = await server.callTool('update_event_block', {
      sheetName: 'MainSheet', sid: 900, addActions: [{ id: 'set-function-return-value', objectClass: name, parameters: { value: '1' } }],
    });
    expect(returned.isError).not.toBe(true);
    await rejectsWithoutWrite({ id: 'nonexistent', objectClass: name }, 'nonexistent');
    await rejectsWithoutWrite({ id: 'map-function', objectClass: name, behaviorType: 'Movement', parameters: { name: '"ResetMap"', string: '"reset"', function: 'Reset' } }, 'behavior');
    await rejectsWithoutWrite({ id: 'go-to-layout', objectClass: name, parameters: { layout: 'Layout 1' } }, 'go-to-layout');
    await rejectsWithoutWrite({ id: 'map-function', objectClass: 'System', parameters: { name: '"ResetMap"', string: '"reset"', function: 'Reset' } }, 'map-function');
  });
  it('validates only surviving changes in combined update and removal requests', async () => {
    await writer.writeEntityFile('eventSheets', 'MainSheet', { name: 'MainSheet', events: [{ eventType: 'block', sid: 900, conditions: [], actions: [{ ...movement(), sid: 901 }] }] });
    const result = await server.callTool('update_event_block', { sheetName: 'MainSheet', sid: 900, updateActions: [{ index: 0, parameters: { typo: '2' } }], removeActionIndices: [0] });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(await readFile(sheetPath, 'utf8')).events[0].actions).toEqual([]);
  });
  it('checks final counts and deduplicates repeated parameter updates', async () => {
    await writer.writeEntityFile('eventSheets', 'MainSheet', { name: 'MainSheet', events: [{ eventType: 'block', sid: 900, conditions: [], actions: [{ ...movement(), sid: 901 }] }] });
    const before = await readFile(sheetPath, 'utf8');
    const excessive = await server.callTool('update_event_block', { sheetName: 'MainSheet', sid: 900, addActions: Array.from({ length: 100 }, () => movement()) });
    expect(excessive.isError).toBe(true);
    expect(await readFile(sheetPath, 'utf8')).toBe(before);
    const repeated = await server.callTool('update_event_block', { sheetName: 'MainSheet', sid: 900, updateActions: Array.from({ length: 101 }, () => ({ index: 0, parameters: { 'max-speed': '1' } })) });
    expect(repeated.isError).not.toBe(true);
  });
  it('also protects the single-action replacement tool', async () => {
    await writer.writeEntityFile('eventSheets', 'MainSheet', { name: 'MainSheet', events: [{ eventType: 'block', sid: 900, conditions: [], actions: [{ ...movement(), sid: 901 }] }] });
    const before = await readFile(sheetPath, 'utf8');
    const result = await server.callTool('update_event_block_action', { sheetName: 'MainSheet', blockSid: 900, actionIndex: 0, parameters: { typo: '1' } });
    expect(result.isError).toBe(true);
    expect(await readFile(sheetPath, 'utf8')).toBe(before);
  });

  it('fails closed when configured knowledge cannot be queried', async () => {
    const unavailable = new KnowledgeBase(root, '/nonexistent/c3-python');
    registerEventTools({ server, reader, writer, idGen: new IdGenerator(), knowledge: unavailable } as any);
    await rejectsWithoutWrite(movement(), 'Knowledge query failed');
  });
});
