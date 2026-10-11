import type { Construct3ProjectReader } from '../construct3/project-reader.js';
import type { KnowledgeBase } from '../knowledge/base.js';
import { getProjectIndex } from '../construct3/analyzers/index-builder.js';
import { getBehaviorType, MAX_ITEMS_PER_BLOCK, MAX_NESTING_DEPTH, MAX_TOTAL_EVENTS } from './event-helpers.js';

interface ContractBlock {
  conditions?: readonly Record<string, unknown>[];
  actions?: readonly Record<string, unknown>[];
  children?: readonly ContractBlock[];
}

export async function validateEventContracts(
  reader: Construct3ProjectReader,
  knowledge: KnowledgeBase,
  block: ContractBlock,
): Promise<void> {
  const families = await reader.readAllFamilies();
  const stack = [{ block, depth: 1 }];
  const contracts = new Map<string, Awaited<ReturnType<KnowledgeBase['query']>>>();
  let count = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (++count > MAX_TOTAL_EVENTS || current.depth > MAX_NESTING_DEPTH) throw new Error('Event contract validation exceeded event-tree limits');
    for (const kind of ['conditions', 'actions'] as const) {
      const items = current.block[kind] ?? [];
      if (items.length > MAX_ITEMS_PER_BLOCK) throw new Error(`Too many ${kind} for contract validation`);
      for (const item of items) {
        if (kind === 'actions' && item.type === 'script') continue;
        if (typeof item.callFunction === 'string') {
          const index = await getProjectIndex(reader);
          if (kind !== 'actions' || item.id !== undefined || item.objectClass !== undefined || item.behaviorType !== undefined || item['behavior-type'] !== undefined) {
            throw new Error('Function call must use callFunction and ordered parameters without an ACE owner, ID or behavior');
          }
          const definition = index.functionDefinitions.get(item.callFunction);
          if (!definition) throw new Error(`Unknown function "${item.callFunction}"`);
          const parameters = item.parameters ?? [];
          if (!Array.isArray(parameters) || parameters.length !== definition.params.length) throw new Error(`Function call "${item.callFunction}" requires ${definition.params.length} ordered arguments`);
          for (const value of parameters) {
            if (!(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))) throw new Error('Function call arguments require expression strings or finite numbers');
          }
          continue;
        }
        if (typeof item.id !== 'string' || typeof item.objectClass !== 'string') throw new Error('ACE must have an id and objectClass');
        const behavior = getBehaviorType({
          behaviorType: item.behaviorType as string | undefined,
          'behavior-type': item['behavior-type'] as string | undefined,
        });
        let ownerType = 'plugin';
        let owner = 'system';
        if (item.objectClass !== 'System') {
          const object = families.get(item.objectClass) ?? await reader.readObjectType(item.objectClass);
          owner = object['plugin-id'] as string;
          if (behavior) {
            const candidates = Array.isArray(object.behaviorTypes) ? [...object.behaviorTypes] : [];
            for (const family of families.values()) {
              if (Array.isArray(family.members) && family.members.includes(item.objectClass) && Array.isArray(family.behaviorTypes)) candidates.push(...family.behaviorTypes);
            }
            const matches = candidates.filter(candidate => candidate.name === behavior);
            if (!matches.length) throw new Error(`Unknown behavior instance "${behavior}" on "${item.objectClass}"; use the instance name, not the addon ID`);
            const owners = new Set(matches.map(candidate => candidate.behaviorId));
            if (owners.size !== 1) throw new Error(`Ambiguous behavior instance "${behavior}" on "${item.objectClass}"`);
            owner = matches[0].behaviorId;
            ownerType = 'behavior';
          }
        } else if (behavior) {
          throw new Error('System cannot own a behavior instance');
        }
        if (typeof owner !== 'string' || !owner) throw new Error(`Missing addon ID for "${item.objectClass}"`);
        const key = JSON.stringify([ownerType, owner, kind, item.id]);
        if (!contracts.has(key)) contracts.set(key, await knowledge.query({ operation: 'get_ace_contract', ownerType, owner, kind, id: item.id }));
        const contract = contracts.get(key)!;
        if (contract.status !== 'verified' || !contract.definition) {
          throw new Error(`No verified ${kind} contract for ${owner}/${item.id}: ${contract.reason ?? 'knowledge coverage is incomplete'}. Use get_ace_contract to investigate.`);
        }
        const parameters = item.parameters ?? {};
        if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) throw new Error('ACE parameters must be a key-value object');
        const values = parameters as Record<string, unknown>;
        const definitions = contract.definition.params ?? [];
        const ids = new Set(definitions.map(parameter => parameter.id));
        for (const id of Object.keys(values)) {
          if (!ids.has(id)) throw new Error(`Unknown parameter "${id}" for ${owner}/${item.id}; expected: ${[...ids].join(', ') || '(none)'}`);
        }
        for (const parameter of definitions) {
          if (!Object.hasOwn(values, parameter.id)) throw new Error(`Missing parameter "${parameter.id}" for ${owner}/${item.id}`);
          const value = values[parameter.id];
          if (parameter.type === 'combo' || parameter.type === 'combo-grouped') {
            const items = parameter.type === 'combo' ? parameter.items : parameter.itemGroups?.flatMap(group => group.items);
            if (!items?.length) throw new Error(`Unsupported parameter type ${parameter.type}: item definitions are unavailable`);
            if (typeof value !== 'string' || !items.includes(value)) throw new Error(`Parameter "${parameter.id}" requires a canonical combo item: ${items.join(', ')}`);
          } else if (parameter.type === 'cmp') {
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 5) throw new Error(`Parameter "${parameter.id}" requires a numeric cmp index from 0 to 5`);
          } else if (['number', 'string', 'any', 'layer', 'groupname', 'template', 'objectname', 'layereffect', 'layouteffect', 'objecteffect',
            'functionname', 'animationframe', 'model3d-string', 'model3d-mesh-string', 'model3d-animation-string', 'tilemapbrush-string',
            'flowchart-string', 'objectinsttags'].includes(parameter.type)) {
            if (!(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))) throw new Error(`Parameter "${parameter.id}" requires an expression string or finite number`);
          } else if (['object', 'layout', 'instancevar', 'instancevarbool', 'eventvar', 'eventvarbool', 'eventvarany', 'function', 'projectfile',
            'audiofile', 'animation', 'timeline', 'ease', 'model3d', 'tilemapbrush', 'flowchart'].includes(parameter.type)) {
            if (typeof value !== 'string') throw new Error(`Parameter "${parameter.id}" requires a ${parameter.type} reference string`);
            if (parameter.type === 'object' && !families.has(value) && !(await reader.listObjectTypes()).includes(value)) throw new Error(`Unknown object reference "${value}"`);
            if (parameter.type === 'layout' && !(await reader.listLayouts()).includes(value)) throw new Error(`Unknown layout reference "${value}"`);
          } else if (parameter.type === 'objinstancevar') {
            if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof (value as Record<string, unknown>).name !== 'string' || typeof (value as Record<string, unknown>).objectClass !== 'string') throw new Error(`Parameter "${parameter.id}" requires an objectClass/name instance-variable reference`);
          } else if (parameter.type === 'keyb') {
            if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) throw new Error(`Parameter "${parameter.id}" requires a keyboard key code from 0 to 255`);
          } else if (parameter.type === 'boolean') {
            if (typeof value !== 'boolean' && value !== 0 && value !== 1) throw new Error(`Parameter "${parameter.id}" requires a boolean or 0/1`);
          } else {
            throw new Error(`Unsupported parameter type "${parameter.type}" for ${owner}/${item.id}; investigate the contract before writing`);
          }
        }
      }
    }
    for (const child of current.block.children ?? []) stack.push({ block: child, depth: current.depth + 1 });
  }
}
