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
import { MockServer } from '../mocks/mock-server.js';

describe('Tilemap instance Editor compatibility', () => {
  let folder: string;
  let reader: Construct3ProjectReader;
  let server: MockServer;
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await server.callTool(name, args);
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    return JSON.parse(result.content[0].text);
  };
  const place = (args: Record<string, unknown> = {}) => call('add_instance_to_layout', {
    layoutName: 'Lab', layerName: 'Layer 0', objectType: 'Terrain', x: 0, y: 0, ...args,
  });
  const savedLayout = async () => JSON.parse(await readFile(join(folder, 'layouts/lab.json'), 'utf8'));
  const validate = async () => {
    const fresh = new Construct3ProjectReader(join(folder, 'project.c3proj'));
    await fresh.loadProject();
    resetProjectIndex();
    return validateProjectIntegrity(fresh);
  };
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'c3-tilemap-instance-'));
    await cp(join(__dirname, '../fixtures/c3-loadable-minimal'), folder, { recursive: true });
    reader = new Construct3ProjectReader(join(folder, 'project.c3proj'));
    await reader.loadProject();
    const ids = new IdGenerator();
    await ids.initialize(reader);
    server = new MockServer();
    registerMutationTools(server as any, reader, new Construct3ProjectWriter(reader, ids), ids);
    await call('create_object', { name: 'Terrain', pluginId: 'Tilemap' });
    await call('create_layout', { name: 'Lab', width: 640, height: 480 });
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
    resetProjectIndex();
  });

  for (const [label, args, dimensions, data, tileWidth, tileHeight] of [
    ['defaults', {}, [3, 3], '9x0', 32, 32],
    ['custom tile dimensions', { width: 70, height: 35, properties: { 'tile-width': 16, 'tile-height': 8 } }, [4, 4], '16x0', 16, 8],
    ['a canvas smaller than one tile', { width: 12, height: 20 }, [1, 1], '0', 32, 32],
  ] as const) {
    it('writes loadable empty tile data with ' + label, async () => {
      await place(args);
      const instance = (await savedLayout()).layers[0].instances[0];
      expect(instance.ownData).toEqual({
        tilemapData: { width: dimensions[0], height: dimensions[1], 'max-width': dimensions[0], 'max-height': dimensions[1], data },
        'tile-width': tileWidth, 'tile-height': tileHeight, 'tile-x-offset': 0, 'tile-y-offset': 0, 'tile-x-spacing': 0, 'tile-y-spacing': 0,
      });
      expect(instance.properties['tile-width']).toBe(tileWidth);
      expect(instance.properties['tile-height']).toBe(tileHeight);
      expect((await validate()).valid).toBe(true);
    });
  }

  it('preserves placed tiles and cropped storage when resizing an existing Tilemap', async () => {
    const placed = await place();
    const layout = await savedLayout();
    const ownData = {
      tilemapData: { width: 2, height: 2, 'max-width': 4, 'max-height': 3, data: '1,4x0,2,6x0' },
      'tile-width': 16, 'tile-height': 16, 'tile-x-offset': 0, 'tile-y-offset': 0, 'tile-x-spacing': 0, 'tile-y-spacing': 0,
    };
    layout.layers[0].instances[0].ownData = ownData;
    await writeFile(join(folder, 'layouts/lab.json'), JSON.stringify(layout));
    await call('update_instance', { layoutName: 'Lab', uid: placed.generatedUid, width: 160, height: 80 });
    const instance = (await savedLayout()).layers[0].instances[0];
    expect(instance.world).toMatchObject({ width: 160, height: 80 });
    expect(instance.ownData).toEqual(ownData);
    expect((await validate()).valid).toBe(true);
  });

  for (const tileWidth of [0, -16, 1.5, '32']) {
    it('refuses invalid tile width ' + tileWidth + ' before changing the layout', async () => {
      const before = await readFile(join(folder, 'layouts/lab.json'));
      const result = await server.callTool('add_instance_to_layout', {
        layoutName: 'Lab', layerName: 'Layer 0', objectType: 'Terrain', x: 0, y: 0, properties: { 'tile-width': tileWidth },
      });
      expect(result.isError).toBe(true);
      expect(await readFile(join(folder, 'layouts/lab.json'))).toEqual(before);
    });
  }

  for (const [label, ownData] of [
    ['absent ownData', undefined],
    ['null ownData', null],
    ['absent tilemapData', {}],
    ['null tilemapData', { tilemapData: null }],
    ['array tilemapData', { tilemapData: [] }],
    ['non-string tile data', { tilemapData: { width: 1, height: 1, 'max-width': 1, 'max-height': 1, data: [] } }],
    ['missing dimensions', { tilemapData: { data: '0' } }],
    ['negative storage height', { tilemapData: { width: 1, height: 1, 'max-width': 1, 'max-height': -1, data: '0' } }],
    ['fractional storage height', { tilemapData: { width: 1, height: 1, 'max-width': 1, 'max-height': 1.5, data: '0' } }],
    ['string active width', { tilemapData: { width: '1', height: 1, 'max-width': 1, 'max-height': 1, data: '0' } }],
  ] as const) {
    it('reports ' + label + ' as a plugin instance shape error', async () => {
      await place();
      const layout = await savedLayout();
      layout.layers[0].instances[0].ownData = ownData;
      await writeFile(join(folder, 'layouts/lab.json'), JSON.stringify(layout));
      const result = await validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(expect.arrayContaining([
        expect.objectContaining({ check: 'plugin-instance-shape', entity: expect.stringContaining('Lab'), message: expect.stringContaining('Terrain') }),
      ]));
    });
  }
});
