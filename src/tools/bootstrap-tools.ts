import { createHash } from 'node:crypto';
import { cp, readFile, readdir, lstat, mkdir, mkdtemp, rename, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KnowledgeBase } from '../knowledge/base.js';
import { Construct3ProjectReader } from '../construct3/project-reader.js';
import { Construct3ProjectWriter } from '../construct3/project-writer.js';
import { IdGenerator } from '../construct3/id-generator.js';
import { resolveProjectPath } from '../construct3/path-utils.js';
import { toolError, toolResult, validateName } from './shared.js';

export function registerBootstrapTools(server: McpServer, knowledge: KnowledgeBase) {
  server.tool('create_project_from_template', 'Copy a local official example into a dedicated new project. Preserves originals, refuses existing destinations, and returns the path for a new MCP connection; the current connection is unchanged.', {
    exampleSlug: z.string().max(200).regex(/^[a-z0-9][a-z0-9-]*$/),
    destinationName: z.string().max(200),
  }, async args => {
    let staging: string | undefined;
    let reserved: string | undefined;
    try {
      validateName(args.destinationName);
      let source = knowledge.root;
      for (const segment of ['official-examples', 'example-projects', args.exampleSlug]) {
        source = resolveProjectPath(source, segment);
        const info = await lstat(source);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Official source directories must not be symlinks');
      }
      const references = await knowledge.query({ operation: 'search_examples', query: args.exampleSlug, limit: 10 });
      const reference = references.results?.find(result => result.slug === args.exampleSlug);
      if (!reference) throw new Error('Example is not present in the configured knowledge inventory');
      const parent = resolveProjectPath(knowledge.root, 'created-projects');
      try { await mkdir(parent); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const parentInfo = await lstat(parent);
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error('Destination parent must be a directory without symlinks');
      const destination = resolveProjectPath(parent, args.destinationName);
      try { await lstat(destination); throw new Error('Destination already exists'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      staging = await mkdtemp(join(parent, '.bootstrap-'));
      await cp(source, staging, { recursive: true, force: false, errorOnExist: true, filter: async path => {
        if ((await lstat(path)).isSymbolicLink()) throw new Error('Official source files must not contain symlinks');
        return true;
      } });
      const paths: string[] = [];
      const directories = [staging];
      while (directories.length) {
        const directory = directories.pop()!;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) directories.push(path); else if (entry.isFile()) paths.push(path); else throw new Error('Source contains unsupported filesystem entries');
        }
      }
      const digest = createHash('sha256');
      for (const path of paths.sort()) {
        digest.update(path.slice(staging.length + 1).replaceAll('\\', '/') + '\0');
        digest.update(createHash('sha256').update(await readFile(path)).digest());
      }
      const copiedTreeHash = digest.digest('hex');
      if (copiedTreeHash !== reference.sourceHash) throw new Error('Local example does not match the indexed source snapshot; refresh its inventory before copying');
      const reader = new Construct3ProjectReader(join(staging, 'project.c3proj'));
      await reader.loadProject();
      await reader.readAllObjectTypes(); await reader.readAllEventSheets(); await reader.readAllLayouts(); await reader.readAllFamilies();
      await new Construct3ProjectWriter(reader, new IdGenerator()).updateProjectProperties({ name: args.destinationName });
      // Reserve the container exclusively; promotion never replaces a previously existing project directory.
      await mkdir(destination);
      reserved = destination;
      await rename(staging, join(destination, 'project'));
      staging = undefined;
      reserved = undefined;
      return toolResult({ projectPath: join(destination, 'project', 'project.c3proj'), source: reference, copiedTreeHash,
        connectionChanged: false, nextStep: 'Start a new MCP connection with this projectPath to inspect, modify and pack the new project.' });
    } catch (error) {
      return toolError(`Project bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true });
      if (reserved) await rmdir(reserved).catch(() => undefined);
    }
  });
}
