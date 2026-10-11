import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const parameterTypes = ['number', 'string', 'any', 'boolean', 'combo', 'combo-grouped', 'cmp', 'object', 'layer', 'layout',
  'instancevar', 'instancevarbool', 'objinstancevar', 'eventvar', 'eventvarbool', 'eventvarany', 'groupname', 'template',
  'objectname', 'layereffect', 'layouteffect', 'objecteffect', 'function', 'functionname', 'variadic', 'keyb', 'projectfile',
  'audiofile', 'animation', 'animationframe', 'timeline', 'ease', 'model3d', 'model3d-string', 'model3d-mesh-string',
  'model3d-animation-string', 'tilemapbrush', 'tilemapbrush-string', 'flowchart', 'flowchart-string', 'objectinsttags'] as const;
const definitionSchema = z.object({
  id: z.string(),
  params: z.array(z.object({ id: z.string(), type: z.enum(parameterTypes), items: z.array(z.string()).optional(),
    itemGroups: z.array(z.object({ id: z.string(), items: z.array(z.string()) })).optional(),
  }).passthrough()).optional(),
}).passthrough();
const responseSchema = z.object({
  status: z.enum(['verified', 'unverified', 'not-found']).optional(), knownOwner: z.boolean().optional(),
  reason: z.string().optional(), evidence: z.string().optional(), definition: definitionSchema.optional(),
  source: z.object({ id: z.string(), url: z.string().optional(), hash: z.string().optional() }).passthrough().optional(),
  results: z.array(z.record(z.unknown())).max(10).optional(),
}).passthrough();
const docsSchema = z.object({ results: z.array(z.object({ id: z.string(), source: z.string(), page: z.number().int(),
  title: z.string(), url: z.string(), text: z.string().max(1800), sourceHash: z.string(), evidence: z.string(),
}).passthrough()).max(10), coverage: z.string() });
const examplesSchema = z.object({ results: z.array(z.object({ slug: z.string(), name: z.string(), tags: z.array(z.string()),
  addons: z.array(z.record(z.unknown())), status: z.record(z.string()), url: z.string(), license: z.string(),
}).passthrough()).max(10), evidence: z.string() });

export class KnowledgeBase {
  readonly root: string;
  constructor(root: string, private python = process.env.C3_KNOWLEDGE_PYTHON || 'python3') {
    this.root = resolve(root);
  }

  async query(request: Record<string, unknown>): Promise<z.infer<typeof responseSchema>> {
    const input = JSON.stringify(request);
    if (Buffer.byteLength(input) > 65_536) throw new Error('Knowledge query request exceeds 64 KiB');
    const script = fileURLToPath(new URL('../../scripts/knowledge-query.py', import.meta.url));
    try {
      const output = await new Promise<string>((accept, reject) => {
        const child = execFile(this.python, [script, resolve(this.root, 'knowledge.sqlite')], {
          timeout: 10_000, maxBuffer: 262_144, encoding: 'utf8',
        }, (error, stdout, stderr) => {
          if (error) reject(new Error(stderr.trim() || error.message));
          else accept(stdout);
        });
        child.stdin?.on('error', reject);
        child.stdin?.end(input);
      });
      const result = responseSchema.parse(JSON.parse(output));
      if (request.operation === 'search_docs') docsSchema.parse(result);
      else if (request.operation === 'search_examples') examplesSchema.parse(result);
      else if (request.operation === 'get_ace_contract') {
        if (!result.status) throw new Error('Missing contract status');
        if (result.status === 'verified') {
          if (result.definition?.id !== request.id || !result.evidence || !result.source?.url || !result.source.hash) {
            throw new Error('Verified contract identity or provenance does not match the request');
          }
        } else if (!result.reason || typeof result.knownOwner !== 'boolean') throw new Error('Missing contract gap details');
      } else throw new Error('Unknown knowledge query operation');
      return result;
    } catch (error) {
      throw new Error(`Knowledge query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
