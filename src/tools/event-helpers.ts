/**
 * Event-related helpers extracted from mutations.ts.
 * Contains Zod schemas, recursive builders, and validators
 * used by event tools (add_event_block, add_event_to_sheet).
 */

import { z } from 'zod';
import type { Construct3ProjectReader } from '../construct3/project-reader.js';
import type { IdGenerator } from '../construct3/id-generator.js';
import type { Condition, Action, BlockEvent } from '../construct3/types.js';
import { createBlockEvent } from '../construct3/templates.js';
import { boundedRecord } from './shared.js';

// ─── Zod Schemas ────────────────────────────────────────────

/** Condition schema shared by top-level and child events */
export const conditionSchema = z.object({
  id: z.string().describe('Condition ACE id (kebab-case, e.g., "on-start-of-layout", "on-collision-with-another-object")'),
  objectClass: z.string().describe('Object name or "System"'),
  behaviorType: z.string().optional().describe('Behavior instance name (e.g., "Platform", "8Direction")'),
  'behavior-type': z.string().optional().describe('Legacy alias for behaviorType'),
  parameters: boundedRecord()
    .refine(obj => JSON.stringify(obj).length <= 50_000, 'Parameters payload too large (max 50KB)')
    .optional().describe('Condition parameters as key-value pairs (max 100 keys, depth 6)'),
  isInverted: z.boolean().optional().describe('Negate the condition'),
  isOr: z.boolean().optional().describe('Deprecated: enables OR for the entire block; use isOrBlock'),
});

/** Standard action schema */
export const standardActionSchema = z.object({
  id: z.string().describe('Action ACE id (kebab-case, e.g., "set-instvar-value", "destroy")'),
  objectClass: z.string().describe('Object name or "System"'),
  behaviorType: z.string().optional().describe('Behavior instance name'),
  'behavior-type': z.string().optional().describe('Legacy alias for behaviorType'),
  parameters: boundedRecord()
    .refine(obj => JSON.stringify(obj).length <= 50_000, 'Parameters payload too large (max 50KB)')
    .optional().describe('Action parameters as key-value pairs (max 100 keys, depth 6)'),
  callFunction: z.string().optional().describe('For function call actions'),
  disabled: z.boolean().optional().describe('Disable this individual action'),
});

/** Script action schema */
export const scriptActionSchema = z.object({
  type: z.literal('script').describe('Script action type'),
  script: z.string().describe('Inline JavaScript code'),
  disabled: z.boolean().optional().describe('Disable this individual script action'),
});

/** Union of standard and script actions */
export const functionCallActionSchema = z.object({
  callFunction: z.string().max(200), parameters: z.array(z.union([z.string().max(50_000), z.number().finite()])).max(100).optional(),
  disabled: z.boolean().optional(),
}).strict();
export const actionSchema = z.union([functionCallActionSchema, standardActionSchema, scriptActionSchema]);

// ─── Recursive Child Event Schema ───────────────────────────

export interface ChildEventInput {
  conditions?: Array<z.infer<typeof conditionSchema>>;
  actions?: Array<z.infer<typeof actionSchema>>;
  disabled?: boolean;
  isElse?: boolean;
  isOrBlock?: boolean;
  children?: ChildEventInput[];
}

export const childEventSchema: z.ZodType<ChildEventInput> = z.lazy(() => z.object({
  conditions: z.array(conditionSchema).optional().default([]),
  actions: z.array(actionSchema).optional().default([]),
  disabled: z.boolean().optional(),
  isElse: z.boolean().optional(),
  isOrBlock: z.boolean().optional(),
  children: z.array(childEventSchema).optional().default([]),
}));

// ─── Safety Limits ──────────────────────────────────────────

export const MAX_NESTING_DEPTH = 5;
export const MAX_TOTAL_EVENTS = 50;
export const MAX_ITEMS_PER_BLOCK = 100;

// Limits for SID-search traversal (matching index-builder.ts)
export const MAX_SEARCH_NODES = 100_000;
export const MAX_SEARCH_DEPTH = 50;

// ─── SID-Based Event Finder ─────────────────────────────────

export interface FindResult {
  event: Record<string, unknown>;
  parentArray: Record<string, unknown>[];
  index: number;
}

/**
 * Find an event by SID anywhere in the event tree.
 * Iterative stack-based traversal (no recursion) with safety guards.
 * Returns the event, its parent array, and index for safe splice operations.
 */
export function findEventBySid(
  events: Record<string, unknown>[],
  targetSid: number,
): FindResult | null {
  const stack: Array<{ events: Record<string, unknown>[]; depth: number }> = [
    { events, depth: 0 },
  ];
  let nodeCount = 0;

  while (stack.length > 0) {
    if (++nodeCount > MAX_SEARCH_NODES) {
      throw new Error(`SID search exceeded ${MAX_SEARCH_NODES} nodes`);
    }
    const { events: currentEvents, depth } = stack.pop()!;
    if (depth > MAX_SEARCH_DEPTH) continue;

    for (let i = 0; i < currentEvents.length; i++) {
      const event = currentEvents[i];
      if (event.sid === targetSid) {
        return { event, parentArray: currentEvents, index: i };
      }
      // Recurse into children (groups, blocks, function-blocks)
      if (Array.isArray(event.children)) {
        stack.push({
          events: event.children as Record<string, unknown>[],
          depth: depth + 1,
        });
      }
    }
  }
  return null;
}

/**
 * Count all descendant events inside an event (groups, blocks with children).
 * Iterative to match safety pattern.
 */
export function countDescendants(event: Record<string, unknown>): number {
  let count = 0;
  const stack: Array<Record<string, unknown>[]> = [];
  if (Array.isArray(event.children)) {
    stack.push(event.children as Record<string, unknown>[]);
  }

  while (stack.length > 0) {
    const children = stack.pop()!;
    for (const child of children) {
      count++;
      if (Array.isArray(child.children)) {
        stack.push(child.children as Record<string, unknown>[]);
      }
    }
  }
  return count;
}

/**
 * Build a navigable summary of top-level events in a sheet (for error messages).
 * Truncated to maxItems to keep error messages manageable.
 */
export function summarizeEvents(
  events: Record<string, unknown>[],
  maxItems = 10,
): string {
  const lines: string[] = [];
  const total = events.length;

  for (let i = 0; i < Math.min(total, maxItems); i++) {
    const e = events[i];
    const type = e.eventType as string;
    switch (type) {
      case 'block': {
        const sid = e.sid as number;
        const conds = (e.conditions as unknown[] | undefined)?.length ?? 0;
        const acts = (e.actions as unknown[] | undefined)?.length ?? 0;
        lines.push(`  - block (SID ${sid}): ${conds} condition(s), ${acts} action(s)`);
        break;
      }
      case 'group': {
        const title = e.title as string;
        const sid = e.sid as number;
        const childCount = Array.isArray(e.children) ? (e.children as unknown[]).length : 0;
        lines.push(`  - group "${title}" (SID ${sid}): ${childCount} children`);
        break;
      }
      case 'function-block': {
        const name = e.functionName as string;
        const sid = e.sid as number;
        lines.push(`  - function "${name}" (SID ${sid})`);
        break;
      }
      case 'variable': {
        const name = e.name as string;
        const sid = e.sid as number;
        lines.push(`  - variable "${name}" (SID ${sid})`);
        break;
      }
      case 'include':
        lines.push(`  - include: "${e.includeSheet as string}"`);
        break;
      case 'comment':
        lines.push(`  - comment: "${(e.text as string).slice(0, 50)}"`);
        break;
      default:
        lines.push(`  - ${type}`);
    }
  }

  if (total > maxItems) {
    lines.push(`  ... (${total - maxItems} more)`);
  }

  return lines.join('\n');
}

// ─── Group Path Traversal ───────────────────────────────────

/** Traverse event tree to find a group by title path (e.g., "Movement > Collision").
 *  Two-pass: verify the full path resolves before mutating any data. */
export function findGroupByPath(
  events: Record<string, unknown>[],
  groupPath: string,
): Record<string, unknown>[] | null {
  const segments = groupPath.split('>').map(s => s.trim());

  // First pass: verify all segments resolve without mutating
  let current = events;
  const groups: Array<Record<string, unknown>> = [];
  for (const seg of segments) {
    const group = current.find(
      (e) => e.eventType === 'group' && e.title === seg,
    ) as Record<string, unknown> | undefined;
    if (!group) return null;
    groups.push(group);
    current = Array.isArray(group.children) ? group.children as Record<string, unknown>[] : [];
  }

  // Full path resolved — ensure all groups have children arrays
  for (const g of groups) {
    if (!Array.isArray(g.children)) g.children = [];
  }

  return groups[groups.length - 1].children as Record<string, unknown>[];
}

export function getBehaviorType(ref: { behaviorType?: string; 'behavior-type'?: string }): string | undefined {
  if (ref.behaviorType && ref['behavior-type'] && ref.behaviorType !== ref['behavior-type']) {
    throw new Error('Conflicting behaviorType and behavior-type values');
  }
  return ref.behaviorType ?? ref['behavior-type'];
}

// ─── Object Class Validation ────────────────────────────────

/** Validate objectClass references against project objects, families, and "System". */
export async function validateObjectClasses(
  reader: Construct3ProjectReader,
  refs: Array<{ objectClass: string; behaviorType?: string; 'behavior-type'?: string }>,
): Promise<{ errors: string[]; warnings: string[] }> {
  const objects = await reader.listObjectTypes();
  // listFamilies() reads from an in-memory Map and never throws — no try/catch needed.
  const families = await reader.listFamilies();
  const validClasses = new Set([...objects, ...families, 'System', 'Functions']);

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const ref of refs) {
    if (!validClasses.has(ref.objectClass)) {
      const suggestions = reader.findNearestName(ref.objectClass, 'objects');
      const hint = suggestions.length > 0
        ? ` Did you mean: ${suggestions.join(', ')}?`
        : '';
      errors.push(`Unknown objectClass "${ref.objectClass}".${hint}`);
    }
    const behaviorType = getBehaviorType(ref);
    if (behaviorType) {
      // Soft validate: warn but allow (behavior may come from families or third-party plugins)
      warnings.push(`Behavior-type "${behaviorType}" on "${ref.objectClass}" was not validated — ensure it exists on the object or its families.`);
    }
  }

  return { errors, warnings };
}

// ─── Object Reference Collection ────────────────────────────

/** Collect all objectClass references from a block and all its descendants.
 *  Depth-limited to match buildBlockEvent's MAX_NESTING_DEPTH guard. */
export function collectObjectRefs(
  conditions: Array<{ objectClass: string; behaviorType?: string; 'behavior-type'?: string }>,
  actions: Array<Record<string, unknown>>,
  children: ChildEventInput[],
  refs: Array<{ objectClass: string; behaviorType?: string; 'behavior-type'?: string }>,
  depth = 0,
): void {
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(`collectObjectRefs nesting exceeds maximum depth of ${MAX_NESTING_DEPTH}`);
  }
  for (const c of conditions) {
    refs.push({ objectClass: c.objectClass, behaviorType: getBehaviorType(c) });
  }
  for (const a of actions) {
    if ('objectClass' in a && typeof a.objectClass === 'string') {
      refs.push({ objectClass: a.objectClass, behaviorType: getBehaviorType(a as { behaviorType?: string; 'behavior-type'?: string }) });
    }
  }
  for (const child of children) {
    collectObjectRefs(
      child.conditions ?? [],
      (child.actions ?? []) as Array<Record<string, unknown>>,
      child.children ?? [],
      refs,
      depth + 1,
    );
  }
}

// ─── Recursive Block Builder ────────────────────────────────

/** Recursively build a block event with conditions, actions, and children.
 *  Returns the built block and increments the counter (for safety limit). */
export async function buildBlockEvent(
  reader: Construct3ProjectReader,
  idGen: IdGenerator,
  block: {
    conditions: Array<z.infer<typeof conditionSchema>>;
    actions: Array<z.infer<typeof actionSchema>>;
    disabled?: boolean;
    isElse?: boolean;
    isOrBlock?: boolean;
    children: ChildEventInput[];
  },
  depth: number,
  counter: { count: number; warnings: string[] },
): Promise<BlockEvent> {
  if (depth > MAX_NESTING_DEPTH) {
    throw new Error(`Sub-event nesting exceeds maximum depth of ${MAX_NESTING_DEPTH}`);
  }
  counter.count++;
  if (counter.count > MAX_TOTAL_EVENTS) {
    throw new Error(`Total event count exceeds maximum of ${MAX_TOTAL_EVENTS}`);
  }

  // Cap conditions and actions per block to prevent SID amplification
  if (block.conditions.length > MAX_ITEMS_PER_BLOCK) {
    throw new Error(`Block has ${block.conditions.length} conditions (max ${MAX_ITEMS_PER_BLOCK})`);
  }
  if (block.actions.length > MAX_ITEMS_PER_BLOCK) {
    throw new Error(`Block has ${block.actions.length} actions (max ${MAX_ITEMS_PER_BLOCK})`);
  }

  const hasLegacyOr = block.conditions.some(c => c.isOr);
  if (hasLegacyOr) {
    counter.warnings.push('Condition isOr is deprecated: OR applies to the entire block. Use isOrBlock.');
  }
  const inputConditions: Array<z.infer<typeof conditionSchema>> = block.isElse && !block.conditions.some(c => c.objectClass === 'System' && c.id === 'else')
    ? [{ id: 'else', objectClass: 'System' }, ...block.conditions]
    : block.conditions;
  if (inputConditions.length > MAX_ITEMS_PER_BLOCK) {
    throw new Error(`Block has ${inputConditions.length} conditions (max ${MAX_ITEMS_PER_BLOCK})`);
  }

  const blockSid = await idGen.generateSid(reader);

  // Build conditions with SIDs
  const builtConditions: Condition[] = [];
  for (const c of inputConditions) {
    const condSid = await idGen.generateSid(reader);
    const cond: Condition = {
      id: c.id,
      objectClass: c.objectClass,
      sid: condSid,
    };
    const behaviorType = getBehaviorType(c);
    if (behaviorType) cond.behaviorType = behaviorType;
    if (c.parameters) cond.parameters = c.parameters;
    if (c.isInverted) cond.isInverted = true;
    builtConditions.push(cond);
  }

  // Build actions with SIDs (or as script actions)
  const builtActions: Action[] = [];
  for (const a of block.actions) {
    if ('type' in a && a.type === 'script') {
      const scriptAct: Action = {
        type: 'script' as const,
        script: a.script,
      };
      if (a.disabled) scriptAct.disabled = true;
      builtActions.push(scriptAct);
    } else if ('callFunction' in a && !('id' in a)) {
      builtActions.push({ callFunction: a.callFunction!, parameters: a.parameters ?? [], sid: await idGen.generateSid(reader), ...(a.disabled ? { disabled: true } : {}) });
    } else if ('id' in a) {
      const actSid = await idGen.generateSid(reader);
      const act: Action = {
        id: a.id,
        objectClass: a.objectClass,
        sid: actSid,
      };
      const behaviorType = getBehaviorType(a);
      if (behaviorType) act.behaviorType = behaviorType;
      if (a.parameters) act.parameters = a.parameters;
      if (a.callFunction) act.callFunction = a.callFunction;
      if (a.disabled) act.disabled = true;
      builtActions.push(act);
    }
  }

  // Recursively build children
  const builtChildren: BlockEvent[] = [];
  for (const child of block.children) {
    const childBlock = await buildBlockEvent(
      reader,
      idGen,
      {
        conditions: child.conditions ?? [],
        actions: child.actions ?? [],
        disabled: child.disabled,
        isElse: child.isElse,
        isOrBlock: child.isOrBlock,
        children: child.children ?? [],
      },
      depth + 1,
      counter,
    );
    builtChildren.push(childBlock);
  }

  return createBlockEvent(
    blockSid,
    builtConditions,
    builtActions,
    block.disabled || undefined,
    builtChildren.length > 0 ? builtChildren : undefined,
    block.isOrBlock || hasLegacyOr || undefined,
  );
}
