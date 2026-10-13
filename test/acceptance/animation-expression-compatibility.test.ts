import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { Construct3ProjectWriter } from '../../src/construct3/project-writer.js';
import { IdGenerator } from '../../src/construct3/id-generator.js';
import { validateProjectIntegrity } from '../../src/construct3/analyzers/integrity.js';
import { resetProjectIndex } from '../../src/construct3/analyzers/index-builder.js';
import { registerMutationTools } from '../../src/tools/mutations.js';
import { validateEventContracts } from '../../src/tools/event-contracts.js';
import type { KnowledgeBase } from '../../src/knowledge/base.js';
import { MockServer } from '../mocks/mock-server.js';

const slots = [
  ['conditions', 'is-animation-playing', 'animation', {}],
  ['conditions', 'on-animation-finished', 'animation', {}],
  ['actions', 'set-animation', 'animation', { from: 'beginning' }],
  ['actions', 'add-remove-animation', 'name', { which: 'add' }],
  ['actions', 'add-remove-animation-frame', 'animation', { which: 'add', where: '0' }],
] as const;

describe('Sprite animation expression compatibility', () => {
  let folder: string;
  let reader: Construct3ProjectReader;
  let server: MockServer;
  let sheetPath: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'c3-animation-expression-'));
    await cp(join(__dirname, '../fixtures/c3-loadable-minimal'), folder, { recursive: true });
    reader = new Construct3ProjectReader(join(folder, 'project.c3proj'));
    await reader.loadProject();
    const ids = new IdGenerator();
    await ids.initialize(reader);
    server = new MockServer();
    registerMutationTools(server as any, reader, new Construct3ProjectWriter(reader, ids), ids);
    const created = await server.callTool('create_object', { name: 'Player', pluginId: 'Sprite' });
    expect(created.isError).not.toBe(true);
    sheetPath = join(folder, 'eventSheets/MainSheet.json');
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
    resetProjectIndex();
  });

  for (const [kind, id, parameter, other] of slots) {
    for (const value of ['Animation 1', 1]) it('refuses invalid animation expression ' + JSON.stringify(value) + ' in ' + id + ' in preflight, write and integrity validation', async () => {
      const ace = { objectClass: 'Player', id, parameters: { ...other, [parameter]: value } };
      const args = { sheetName: 'MainSheet', disabled: true, conditions: [], actions: [], [kind]: [ace] };
      const before = await readFile(sheetPath);
      for (const dryRun of [true, false]) {
        const result = await server.callTool('add_event_block', { ...args, dryRun });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('expression');
        expect(await readFile(sheetPath)).toEqual(before);
      }
      const sheet = JSON.parse(before.toString());
      sheet.events.push({ eventType: 'block', sid: 810000000000001, disabled: true, conditions: [], actions: [], [kind]: [{ ...ace, sid: 810000000000002 }] });
      await writeFile(sheetPath, JSON.stringify(sheet));
      const fresh = new Construct3ProjectReader(join(folder, 'project.c3proj'));
      await fresh.loadProject();
      resetProjectIndex();
      const result = await validateProjectIntegrity(fresh);
      expect(result.valid).toBe(false);
      expect(result.errors.some(issue => issue.check === 'expression-syntax' && issue.message.includes(id))).toBe(true);
    });
  }

  it('keeps quoted animation names and dynamic expressions unchanged', async () => {
    for (const value of ['"Animation 1"', 'Player.AnimationName', '"Move" & str(Player.X)', 'choose("Idle", "Run")', '1']) {
      for (const [kind, id, parameter, other] of slots) {
        const result = await server.callTool('add_event_block', {
          sheetName: 'MainSheet', disabled: true, conditions: [], actions: [],
          [kind]: [{ objectClass: 'Player', id, parameters: { ...other, [parameter]: value } }],
        });
        expect(result.isError, result.content[0]?.text).not.toBe(true);
        const sheet = JSON.parse(await readFile(sheetPath, 'utf8'));
        expect(sheet.events.at(-1)[kind][0].parameters[parameter]).toBe(value);
      }
    }
    expect((await validateProjectIntegrity(reader)).valid).toBe(true);
  });

  it('does not apply Sprite animation syntax to a third-party action with the same ID', async () => {
    const objectPath = join(folder, 'objectTypes/player.json');
    const object = JSON.parse(await readFile(objectPath, 'utf8'));
    object['plugin-id'] = 'ThirdPartySprite';
    await writeFile(objectPath, JSON.stringify(object));
    const result = await server.callTool('add_event_block', {
      sheetName: 'MainSheet', actions: [{ objectClass: 'Player', id: 'set-animation', parameters: { animation: 'Animation 1' } }],
    });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
  });

  it('requires serialized expression strings for animation contracts', async () => {
    const knowledge = { query: async () => ({ status: 'verified', definition: { id: 'set-animation', params: [{ id: 'animation', type: 'animation' }] } }) } as unknown as KnowledgeBase;
    await expect(validateEventContracts(reader, knowledge, {
      actions: [{ objectClass: 'Player', id: 'set-animation', parameters: { animation: 1 } }],
    })).rejects.toThrow('expression string');
    for (const animation of ['"Animation 1"', 'Player.AnimationName', '"Move" & str(Player.X)', '1']) {
      await expect(validateEventContracts(reader, knowledge, {
        actions: [{ objectClass: 'Player', id: 'set-animation', parameters: { animation } }],
      })).resolves.toBeUndefined();
    }
  });
});
