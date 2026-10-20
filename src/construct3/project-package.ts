import { readFile, readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { entityFilePath, entityFolderPaths, type Construct3ProjectReader } from './project-reader.js';
import { resolveProjectPath } from './path-utils.js';
import { writeZip } from '../runtime/zip-writer.js';

const ENTITY_FOLDERS = ['objectTypes', 'eventSheets', 'layouts', 'families'] as const;
// Keep complete asset trees: scripts and project files can reference unregistered dependencies.
const RESOURCE_FOLDERS = new Set(['images', 'scripts', 'sounds', 'music', 'videos', 'fonts', 'icons', 'files', 'timelines', 'flowcharts', 'models', 'addons', 'effects']);

/** Canonical archive paths are independent of the legacy files the Reader accepts. */
export async function packProject(reader: Construct3ProjectReader, outputPath: string) {
  const root = reader.getProjectDir();
  const realRoot = await realpath(root);
  const output = resolve(outputPath);
  const outputTarget = await realpath(output).catch(error => {
    if (error.code === 'ENOENT') return output;
    throw error;
  });
  const entries = new Map<string, string>();
  const excluded: Array<{ path: string; reason: string }> = [];
  const exclude = (path: string, reason: string) => excluded.push({ path, reason });
  const add = (path: string, source: string) => {
    resolveProjectPath(root, path);
    if (path.includes('\\') || /^[a-z]:/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Unsafe package path: ${path}`);
    }
    if (entries.has(path) && entries.get(path) !== source) throw new Error(`Duplicate package path: ${path}`);
    entries.set(path, source);
  };
  add(basename(reader.getProjectPath()), reader.getProjectPath());
  for (const category of ENTITY_FOLDERS) {
    for (const [name, folder] of entityFolderPaths(reader.getProject()[category])) {
      add(entityFilePath(category, folder, name), await reader.getEntityFilePath(category, name));
    }
  }
  const registered = new Set([...entries.values()].map(path => resolve(path)));
  const walk = async (path = '', depth = 0): Promise<void> => {
    if (depth > 50) throw new Error(`Package directory nesting exceeds 50: ${path}`);
    const items = await readdir(resolveProjectPath(root, path), { withFileTypes: true });
    for (const item of items) {
      const child = path ? `${path}/${item.name}` : item.name;
      const source = resolveProjectPath(root, child);
      if (registered.has(source)) continue;
      if (source === output) { exclude(child, 'package output'); continue; }
      if (item.isSymbolicLink()) { exclude(child, 'unregistered symbolic link'); continue; }
      if (item.name.startsWith('.') || item.name.endsWith('.bak') || item.name.endsWith('.uistate.json') || item.name.endsWith('.c3p') || item.name === 'Thumbs.db') {
        exclude(child + (item.isDirectory() ? '/' : ''), 'cache, backup, Editor state or package'); continue;
      }
      if (item.isDirectory()) {
        if (!path && !RESOURCE_FOLDERS.has(item.name) && !ENTITY_FOLDERS.includes(item.name as typeof ENTITY_FOLDERS[number])) {
          exclude(`${child}/`, 'not an engine resource directory'); continue;
        }
        await walk(child, depth + 1);
      } else if (item.isFile()) {
        if (!path || ENTITY_FOLDERS.some(category => child.startsWith(`${category}/`))) exclude(child, 'not a registered entity or engine resource');
        else add(child, source);
      }
    }
  };
  await walk();
  const included = [...entries.keys()].sort();
  const archive = await Promise.all(included.map(async path => {
    const source = entries.get(path)!;
    const actual = await realpath(source);
    const rel = relative(realRoot, actual);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error(`Package resource escapes project: ${path}`);
    if (resolve(source) === output || actual === outputTarget) throw new Error('Package output would replace a project resource');
    return { path, data: await readFile(source) };
  }));
  await writeZip(archive, output);
  return { included, excluded: excluded.sort((a, b) => a.path.localeCompare(b.path)) };
}
