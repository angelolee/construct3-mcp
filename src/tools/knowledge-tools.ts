import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KnowledgeBase } from '../knowledge/base.js';
import { toolError, toolResult } from './shared.js';

export function registerKnowledgeTools(server: McpServer, knowledge: KnowledgeBase) {
  const limit = z.number().int().min(1).max(10).optional().default(5);
  const run = (operation: string) => async (args: Record<string, unknown>) => {
    try { return toolResult(await knowledge.query({ operation, ...args })); }
    catch (error) { return toolError(error instanceof Error ? error.message : String(error)); }
  };
  server.tool('search_construct_docs', 'Search the local official manual snapshot. Returns bounded passages, URLs, page IDs and source hashes.', {
    query: z.string().min(1).max(250).describe('SQLite FTS5 query, such as "picked instances" or platform AND jump'), limit,
  }, run('search_docs'));
  server.tool('search_construct_examples', 'Find original examples by mechanic or addon. Results distinguish structural inventory from Editor/runtime evidence.', {
    query: z.string().max(250).optional().default('').describe('Words matching example names, tags or addons'),
    addonId: z.string().max(100).optional(), limit,
  }, run('search_examples'));
  server.tool('get_ace_contract', 'Retrieve an exact ACE contract with provenance and explicit coverage gaps. Common applicability must be supported by owner evidence.', {
    ownerType: z.enum(['plugin', 'behavior', 'common']),
    owner: z.string().max(100).describe('Addon ID, System, or builtin for common contracts'),
    kind: z.enum(['conditions', 'actions', 'expressions']), id: z.string().max(200),
  }, run('get_ace_contract'));
}
