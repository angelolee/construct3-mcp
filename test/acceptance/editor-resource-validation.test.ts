import { it, expect } from 'vitest';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { validateProjectIntegrity } from '../../src/construct3/analyzers/integrity.js';
import { resetProjectIndex } from '../../src/construct3/analyzers/index-builder.js';

for (const [pluginId, extra, check] of [
  ['NinePatch', {}, 'plugin-resource-shape'],
  ['Shape3D', {}, 'plugin-resource-shape'],
  ['Keyboard', {}, 'plugin-object-shape'],
  ['Sprite', { 'singleglobal-inst': { type: 'Broken', properties: {}, uid: 20, sid: 100000000000011 } }, 'plugin-object-shape'],
] as const) {
  it('refuses an Editor-invalid ' + pluginId + ' declaration before claiming valid', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'c3-editor-validate-'));
    try {
      await cp(join(__dirname, '../fixtures/c3-loadable-minimal'), folder, { recursive: true });
      const projectPath = join(folder, 'project.c3proj');
      const project = JSON.parse(await readFile(projectPath, 'utf8'));
      project.objectTypes.items = ['Broken'];
      project.usedAddons.push({ type: 'plugin', id: pluginId, name: pluginId, author: 'Scirra' });
      await writeFile(projectPath, JSON.stringify(project));
      await mkdir(join(folder, 'objectTypes'), { recursive: true });
      await writeFile(join(folder, 'objectTypes/broken.json'), JSON.stringify({
        name: 'Broken', 'plugin-id': pluginId, sid: 100000000000010, isGlobal: false, instanceVariables: [], ...extra,
      }));
      const reader = new Construct3ProjectReader(projectPath);
      await reader.loadProject();
      resetProjectIndex();
      const result = await validateProjectIntegrity(reader);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.check === check)).toBe(true);
    } finally {
      await rm(folder, { recursive: true, force: true });
      resetProjectIndex();
    }
  });
}
