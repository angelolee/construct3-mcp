import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Construct3ProjectReader } from '../construct3/project-reader.js';
import { forEachLayoutInstance, layerPath } from '../construct3/layers.js';
import { nameKey } from '../construct3/names.js';
import { toolError, toolResult } from './shared.js';
import { withProjectSync } from './project-sync.js';

function page<T>(items: T[], limit: number) {
  return { items: items.slice(0, limit), total: items.length, truncated: items.length > limit };
}

export function registerObjectContextTool(mcpServer: McpServer, reader: Construct3ProjectReader) {
  const server = withProjectSync(mcpServer, reader);
  server.tool('get_object_editing_context',
    'Read a bounded native editing context for one object type or family: plugin ID, actual own/inherited behavior instance names and addon IDs, variables, and paged UID/SID placements with layout, layer path and event sheet. Coverage gaps are explicit. Does not infer runtime picking or script references.', {
      name: z.string().min(1).max(200),
      placementOffset: z.number().int().min(0).optional().default(0),
      limit: z.number().int().min(1).max(20).optional().default(10),
    }, async ({ name, placementOffset, limit }) => {
      try {
        const objectNames = await reader.listObjectTypes();
        const familyNames = await reader.listFamilies();
        const matches = [
          ...objectNames.map(name => ({ name, category: 'objectTypes' as const })),
          ...familyNames.map(name => ({ name, category: 'families' as const })),
        ].filter(item => nameKey(item.name) === nameKey(name));
        if (matches.length !== 1) return toolError(matches.length ? `Ambiguous object/family name "${name}". Use list_objects and list_families.` : `Unknown object/family "${name}". Use list_objects and list_families.`);
        const target = matches[0];
        const object = target.category === 'families' ? await reader.readFamily(target.name) : await reader.readObjectType(target.name);
        if (typeof object['plugin-id'] !== 'string') return toolError(`Missing plugin ID for "${target.name}".`);
        const families = await reader.readAllFamilies();
        const layouts = await reader.readAllLayouts();
        const warnings: string[] = [];
        let malformed = false;
        const records = (value: unknown, required = false): Record<string, unknown>[] => {
          if (value === undefined && !required) return [];
          if (!Array.isArray(value)) { malformed = true; return []; }
          return value.filter((v): v is Record<string, unknown> => {
            const valid = v !== null && typeof v === 'object' && !Array.isArray(v);
            if (!valid) malformed = true;
            return valid;
          });
        };
        const identity = (value: unknown, minimum: number): number | null => {
          if (typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum) return value;
          malformed = true;
          return null;
        };
        const membersOf = (family: Record<string, unknown>): string[] => {
          if (!Array.isArray(family.members)) { malformed = true; return []; }
          return family.members.filter((m): m is string => {
            if (typeof m === 'string') return true;
            malformed = true;
            return false;
          });
        };
        // Project JSON is untrusted; cap individual fields as well as list sizes.
        const text = (value: unknown): string | undefined => {
          if (typeof value !== 'string') { malformed = true; return undefined; }
          if (value.length > 300) { malformed = true; return value.slice(0, 300); }
          return value;
        };
        const familyMembers = new Map([...families].map(([name, family]) => [name, membersOf(family)]));
        const memberNames = target.category === 'families' ? membersOf(object) : [];
        const memberships = target.category === 'objectTypes' ? [...families].filter(([familyName]) => familyMembers.get(familyName)?.includes(target.name)) : [];
        const declarations = [{ name: target.name, data: object, inherited: false }, ...memberships.map(([name, data]) => ({ name, data, inherited: true }))];
        const behaviors = declarations.flatMap(d => records(d.data.behaviorTypes).map(b => ({ name: text(b.name), addonId: text(b.behaviorId), origin: text(d.name), inherited: d.inherited })));
        const variables = declarations.flatMap(d => records(d.data.instanceVariables).map(v => ({ name: text(v.name), type: text(v.type), origin: text(d.name), inherited: d.inherited })));
        const byBehavior = new Map<string, number>();
        for (const behavior of behaviors) if (behavior.name) byBehavior.set(behavior.name, (byBehavior.get(behavior.name) ?? 0) + 1);
        for (const [name, count] of byBehavior) if (count > 1) warnings.push(`Ambiguous behavior instance "${name}": ${count} declarations. Resolve it before choosing an ACE owner.`);
        const missingMembers = memberNames.filter(member => !objectNames.includes(member));
        if (missingMembers.length) warnings.push('Some family members are not registered object types; inspect get_object_details and validate_project.');
        const placementTypes = new Set(target.category === 'families' ? memberNames : [target.name]);
        const placements: Record<string, unknown>[] = [];
        let placementTotal = 0;
        for (const [layoutName, layout] of layouts) {
          const layers = records(layout.layers, true);
          for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            text(layer.name);
            const instances = records(layer.instances, true);
            for (const instance of instances) {
              text(instance.type); identity(instance.uid, 0); identity(instance.sid, 1);
            }
            layers.push(...records(layer.subLayers));
          }
          for (const instance of records(layout['nonworld-instances'])) {
            text(instance.type); identity(instance.uid, 0); identity(instance.sid, 1);
          }
          forEachLayoutInstance(layout, (instance, entry) => {
          if (!placementTypes.has(instance.type)) return;
          const position = placementTotal++;
          if (position < placementOffset || placements.length >= limit) return;
          placements.push({ type: text(instance.type), uid: identity(instance.uid, 0), sid: identity(instance.sid, 1),
            layout: text(layoutName), eventSheet: layout.eventSheet ? text(layout.eventSheet) : null,
            kind: entry ? 'world' : 'non-world', layerPath: entry ? layerPath(entry).slice(0, 20).map(text) : [],
            layerPathTruncated: entry ? entry.depth >= 20 : false });
          if (entry && entry.depth >= 20) malformed = true;
          });
        }
        const unscanned = (['families', 'layouts'] as const).flatMap(category => [...reader.getReadFailures(category)].map(([name, failure]) => ({ category, name: text(name), code: failure.code })));
        const bounded = { behaviors: page(behaviors, 50), instanceVariables: page(variables, 50), families: page(memberships.map(([name]) => text(name)), 20), members: page(memberNames.map(text), 20), unscanned: page(unscanned, 20), warnings: page(warnings, 20) };
        const truncated = Object.values(bounded).some(p => p.truncated);
        const result = {
          object: { name: text(target.name), category: target.category, file: reader.getEntityRelativePath(target.category, target.name), sid: identity(object.sid, 1),
            pluginId: text(object['plugin-id']), isGlobal: object.isGlobal === true, singleton: Object.hasOwn(object, 'singleglobal-inst') },
          behaviors: bounded.behaviors, instanceVariables: bounded.instanceVariables, families: bounded.families, members: bounded.members,
          placements: { items: placements, total: placementTotal, offset: placementOffset, nextOffset: placementOffset + placements.length < placementTotal ? placementOffset + placements.length : null },
          warnings: bounded.warnings.items,
          coverage: { complete: unscanned.length === 0 && !malformed && !truncated && missingMembers.length === 0,
            unscanned: bounded.unscanned, truncated, malformedOrOversizedFields: malformed,
            scope: 'Declarations and loaded layout placements only; event/script references and runtime selection require separate checks.' },
          nextTools: ['get_object_dependencies', 'get_eventsheet_flow', 'get_eventsheet_outline', 'get_ace_contract', 'validate_project'],
          bindingRule: 'Use object.name as objectClass and the actual behavior name as behaviorType. Query get_ace_contract with the pluginId or behavior addonId; resolve ambiguous names first.',
        };
        if (Buffer.byteLength(JSON.stringify(result, null, 2)) > 128 * 1024) return toolError('Editing context exceeds 128 KiB. Use a smaller placement limit and inspect declarations with get_object_details.');
        return toolResult(result, { projectWritten: false });
      } catch (error) { return toolError(`Error reading editing context: ${error instanceof Error ? error.message : String(error)}`); }
    });
}
