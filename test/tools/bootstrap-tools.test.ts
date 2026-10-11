import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { cp, readdir, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockServer } from '../mocks/mock-server.js';
import { registerBootstrapTools } from '../../src/tools/bootstrap-tools.js';

describe('Official project bootstrap', () => {
  let root: string;
  let source: string;
  let server: MockServer;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'c3-bootstrap-'));
    source = join(root, 'official-examples/example-projects/template-test');
    await mkdir(source, { recursive: true });
    await cp(join(__dirname, '../fixtures/minimal-project'), source, { recursive: true });
    await writeFile(join(source, 'asset.bin'), Buffer.from([1, 2, 3, 255]));
    const paths: string[] = [];
    const collect = async (directory: string) => { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); if (entry.isDirectory()) await collect(path); else paths.push(path); } };
    await collect(source);
    const digest = createHash('sha256');
    for (const path of paths.sort()) { digest.update(path.slice(source.length + 1).replaceAll('\\', '/') + '\0'); digest.update(createHash('sha256').update(await readFile(path)).digest()); }
    const sourceHash = digest.digest('hex');
    server = new MockServer();
    registerBootstrapTools(server as any, { root, query: async () => ({ results: [{ slug: 'template-test', url: 'https://example.test/source', sourceHash, license: 'test-only' }] }) } as any);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const call = (server: MockServer, destinationName = 'NewGame', exampleSlug = 'template-test') => server.callTool('create_project_from_template', { exampleSlug, destinationName });

  it('copies assets, preserves the source and returns an explicit connection target', async () => {
    const original = await readFile(join(source, 'project.c3proj'));
    const result = await call(server);
    expect(result.isError).not.toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.projectPath).toBe(join(root, 'created-projects/NewGame/project/project.c3proj'));
    expect(data.connectionChanged).toBe(false);
    expect(JSON.parse(await readFile(data.projectPath, 'utf8')).name).toBe('NewGame');
    expect(await readFile(join(root, 'created-projects/NewGame/project/asset.bin'))).toEqual(Buffer.from([1, 2, 3, 255]));
    expect(await readFile(join(source, 'project.c3proj'))).toEqual(original);
  });
  it('refuses an existing destination without changing its files', async () => {
    await call(server);
    const marker = join(root, 'created-projects/NewGame/marker');
    await writeFile(marker, 'keep');
    expect((await call(server)).isError).toBe(true);
    expect(await readFile(marker, 'utf8')).toBe('keep');
  });
  it('rejects traversal in names and source IDs', async () => {
    expect((await call(server, '../escape')).isError).toBe(true);
    await expect(call(server, 'NewGame', '../template-test')).rejects.toThrow();
  });
  it('rejects a source symlink without creating a project', async () => {
    await symlink(join(root, 'outside'), join(source, 'escaped.bin'));
    const result = await call(server);
    expect(result.isError).toBe(true);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(join(root, 'created-projects')).catch(() => [])).toEqual([]);
  });
  it('rejects a destination parent symlink', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'c3-outside-'));
    try {
      await symlink(outside, join(root, 'created-projects'));
      expect((await call(server)).isError).toBe(true);
      const { readdir } = await import('node:fs/promises');
      expect(await readdir(outside)).toEqual([]);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });
  it('rejects local source drift from the indexed snapshot', async () => {
    await writeFile(join(source, 'asset.bin'), 'changed');
    const result = await call(server);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('snapshot');
  });
  it('does not promote a malformed copied project or leave partial files', async () => {
    await writeFile(join(source, 'project.c3proj'), '{broken');
    expect((await call(server)).isError).toBe(true);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(join(root, 'created-projects')).catch(() => [])).toEqual([]);
  });
});
