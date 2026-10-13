import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const common = { tags: '"probe"', time: '1', 'destroy-on-complete': 'no', loop: 'no', 'ping-pong': 'no', 'repeat-count': '1' };
const slots = [
  ['set-tweens-ease', { tags: '"probe"' }],
  ['set-all-tweens-ease', {}],
  ['tween-one-property', { ...common, property: 'offsetX', 'end-value': '1' }],
  ['tween-two-properties', { ...common, property: 'position', 'end-x': '1', 'end-y': '1' }],
  ['tween-three-properties', { ...common, property: 'position3', 'end-x': '1', 'end-y': '1', 'end-z': '1' }],
  ['tween-value', { ...common, 'start-value': '1', 'end-value': '1' }],
] as const;

// Canonical selector IDs observed in the r495.2 Editor's Hce.hhe initializer, not runtime aliases.
const canonicalEases = [
  'default', 'noease', 'easeinsine', 'easeoutsine', 'easeinoutsine', 'easeinelastic', 'easeoutelastic', 'easeinoutelastic',
  'easeinback', 'easeoutback', 'easeinoutback', 'easeinbounce', 'easeoutbounce', 'easeinoutbounce',
  'easeincubic', 'easeoutcubic', 'easeinoutcubic', 'easeinquad', 'easeoutquad', 'easeinoutquad',
  'easeinquart', 'easeoutquart', 'easeinoutquart', 'easeinquint', 'easeoutquint', 'easeinoutquint',
  'easeincirc', 'easeoutcirc', 'easeinoutcirc', 'easeinexpo', 'easeoutexpo', 'easeinoutexpo',
];

describe('Tween ease reference compatibility', () => {
  let folder: string;
  let reader: Construct3ProjectReader;
  let server: MockServer;
  let sheetPath: string;
  const action = (ease: unknown, objectClass = 'Player') => ({ id: 'set-all-tweens-ease', objectClass, behaviorType: 'MotionCurve', parameters: { ease } });
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'c3-ease-reference-'));
    await cp(join(__dirname, '../fixtures/c3-loadable-minimal'), folder, { recursive: true });
    reader = new Construct3ProjectReader(join(folder, 'project.c3proj'));
    await reader.loadProject();
    const ids = new IdGenerator();
    await ids.initialize(reader);
    server = new MockServer();
    registerMutationTools(server as any, reader, new Construct3ProjectWriter(reader, ids), ids);
    expect((await server.callTool('create_object', { name: 'Player', pluginId: 'Sprite' })).isError).not.toBe(true);
    expect((await server.callTool('update_object_properties', { name: 'Player', addBehaviors: [{ name: 'MotionCurve', behaviorId: 'Tween' }] })).isError).not.toBe(true);
    sheetPath = join(folder, 'eventSheets/MainSheet.json');
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
    resetProjectIndex();
  });

  async function addCustomEase(nested = false, createFile = true, register = true) {
    const projectPath = join(folder, 'project.c3proj');
    const project = JSON.parse(await readFile(projectPath, 'utf8'));
    if (register) project.timelines.subfolders = [{ items: nested ? [] : ['linear'], subfolders: nested ? [{ name: 'Curves', items: ['linear'], subfolders: [] }] : [] }];
    await writeFile(projectPath, JSON.stringify(project));
    if (createFile) {
      const dir = join(folder, 'timelines/transitions', nested ? 'Curves' : '');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'linear.json'), JSON.stringify({ name: 'linear', linear: true, purpose: 'any', transitionKeyframes: [
        { x: 0, y: 0, sax: 0, say: 0, eax: 0, eay: 0, se: false, ee: false, sm: 'linear' },
        { x: 1, y: 1, sax: 0, say: 0, eax: 0, eay: 0, se: false, ee: false, sm: 'linear' },
      ] }));
    }
    await reader.reloadProject();
  }

  async function expectRejectedAndDetected(ace: Record<string, unknown>, message: RegExp) {
    const before = await readFile(sheetPath);
    for (const dryRun of [true, false]) {
      const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', disabled: true, actions: [ace], dryRun });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(message);
      expect(await readFile(sheetPath)).toEqual(before);
    }
    const sheet = JSON.parse(before.toString());
    sheet.events.push({ eventType: 'block', sid: 810000000000001, disabled: true, conditions: [], actions: [{ ...ace, sid: 810000000000002 }] });
    await writeFile(sheetPath, JSON.stringify(sheet));
    await reader.reloadProject();
    resetProjectIndex();
    const result = await validateProjectIntegrity(reader);
    expect(result.valid).toBe(false);
    expect(result.errors.some(issue => issue.check === 'ease-reference' && message.test(issue.message))).toBe(true);
  }

  for (const [id, parameters] of slots) {
    it(`rejects unresolved linear in disabled ${id} before writing and during integrity checks`, async () => {
      await expectRejectedAndDetected({ ...action('linear'), id, parameters: { ...parameters, ease: 'linear' } }, /ease.*linear/i);
    });
  }

  it('preserves every canonical Editor ease ID', async () => {
    for (const ease of canonicalEases) {
      const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', disabled: true, actions: [action(ease)] });
      expect(result.isError, result.content[0]?.text).not.toBe(true);
      expect(JSON.parse(await readFile(sheetPath, 'utf8')).events.at(-1).actions[0].parameters.ease).toBe(ease);
    }
    expect((await validateProjectIntegrity(reader)).valid).toBe(true);
  });

  for (const nested of [false, true]) it(`preserves a registered custom linear ease${nested ? ' in a subfolder' : ''}`, async () => {
    await addCustomEase(nested);
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [action('linear')] });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    expect(JSON.parse(await readFile(sheetPath, 'utf8')).events.at(-1).actions[0].parameters.ease).toBe('linear');
    expect((await validateProjectIntegrity(reader)).valid).toBe(true);
  });

  it('rejects a registered custom ease with no backing file', async () => {
    await addCustomEase(false, false);
    await expectRejectedAndDetected(action('linear'), /ease.*linear.*(?:read|file)/i);
  });

  it('rejects an unregistered custom ease even when its file exists', async () => {
    await addCustomEase(false, true, false);
    await expectRejectedAndDetected(action('linear'), /ease.*linear.*register/i);
  });

  it('rejects non-string ease references without converting them', async () => {
    await expectRejectedAndDetected(action(1), /ease.*string/i);
  });

  it('resolves Tween by behavior ID on both families and their member objects', async () => {
    const objectPath = join(folder, 'objectTypes/player.json');
    const object = JSON.parse(await readFile(objectPath, 'utf8'));
    const behaviorTypes = object.behaviorTypes;
    object.behaviorTypes = [];
    await writeFile(objectPath, JSON.stringify(object));
    expect((await server.callTool('create_family', { name: 'Actors', pluginId: 'Sprite', members: ['Player'] })).isError).not.toBe(true);
    const familyPath = join(folder, 'families/actors.json');
    const family = JSON.parse(await readFile(familyPath, 'utf8'));
    family.behaviorTypes = behaviorTypes;
    await writeFile(familyPath, JSON.stringify(family));
    for (const objectClass of ['Player', 'Actors']) {
      const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [action('linear', objectClass)] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/ease.*linear/i);
    }
  });

  it('does not apply native Tween semantics to a third-party behavior with matching action IDs', async () => {
    const objectPath = join(folder, 'objectTypes/player.json');
    const object = JSON.parse(await readFile(objectPath, 'utf8'));
    object.behaviorTypes[0].behaviorId = 'ThirdPartyTween';
    await writeFile(objectPath, JSON.stringify(object));
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [action('linear')] });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    expect((await validateProjectIntegrity(reader)).errors.filter(issue => issue.check === 'ease-reference')).toEqual([]);
  });

  it('checks ease reference resolution when validating verified mutation contracts', async () => {
    const knowledge = { query: async () => ({ status: 'verified', definition: { id: 'set-all-tweens-ease', params: [{ id: 'ease', type: 'ease' }] } }) } as unknown as KnowledgeBase;
    await expect(validateEventContracts(reader, knowledge, { actions: [action('linear')] })).rejects.toThrow(/ease.*linear/i);
    await expect(validateEventContracts(reader, knowledge, { actions: [action('noease')] })).resolves.toBeUndefined();
    await addCustomEase(true);
    await expect(validateEventContracts(reader, knowledge, { actions: [action('linear')] })).resolves.toBeUndefined();
  });

  it('preserves the Editor-saved object form of a registered custom ease', async () => {
    await addCustomEase();
    const curve = JSON.parse(await readFile(join(folder, 'timelines/transitions/linear.json'), 'utf8'));
    const ease = { name: 'linear', json: [{ folders: [], json: curve }] };
    const knowledge = { query: async () => ({ status: 'verified', definition: { id: 'set-all-tweens-ease', params: [{ id: 'ease', type: 'ease' }] } }) } as unknown as KnowledgeBase;
    await expect(validateEventContracts(reader, knowledge, { actions: [action(ease)] })).resolves.toBeUndefined();
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [action(ease)] });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    expect(JSON.parse(await readFile(sheetPath, 'utf8')).events.at(-1).actions[0].parameters.ease).toEqual(ease);
    expect((await validateProjectIntegrity(reader)).errors.filter(issue => issue.check === 'ease-reference')).toEqual([]);
    await expect(validateEventContracts(reader, knowledge, { actions: [action({ name: 'linear' })] })).resolves.toBeUndefined();
  });

  it('preserves an embedded custom ease import and reports the limits of static checking', async () => {
    await addCustomEase(false, true, false);
    const curve = JSON.parse(await readFile(join(folder, 'timelines/transitions/linear.json'), 'utf8'));
    const ease = { name: 'ExternalName', json: [{ folders: ['Curves'], json: curve }] };
    const knowledge = { query: async () => ({ status: 'verified', definition: { id: 'set-all-tweens-ease', params: [{ id: 'ease', type: 'ease' }] } }) } as unknown as KnowledgeBase;
    await expect(validateEventContracts(reader, knowledge, { actions: [action(ease)] })).resolves.toBeUndefined();
    const result = await server.callTool('add_event_block', { sheetName: 'MainSheet', actions: [action(ease)] });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    expect(JSON.parse(await readFile(sheetPath, 'utf8')).events.at(-1).actions[0].parameters.ease).toEqual(ease);
    const integrity = await validateProjectIntegrity(reader);
    expect(integrity.errors.filter(issue => issue.check === 'ease-reference')).toEqual([]);
    expect(integrity.warnings.some(issue => issue.check === 'ease-reference' && /keyframe/i.test(issue.message))).toBe(true);
  });
});
