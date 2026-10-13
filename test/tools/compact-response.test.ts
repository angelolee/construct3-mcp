import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Construct3ProjectReader } from '../../src/construct3/project-reader.js';
import { registerQueryTools } from '../../src/tools/query.js';
import { registerAnalysisTools } from '../../src/tools/analysis.js';
import { MockServer } from '../mocks/mock-server.js';

describe('compact read-only JSON responses', () => {
  let server: MockServer;
  beforeAll(async () => {
    const reader = new Construct3ProjectReader(join(process.cwd(), 'test/fixtures/minimal-project/project.c3proj'));
    await reader.loadProject();
    server = new MockServer();
    registerQueryTools(server as unknown as McpServer, reader);
    registerAnalysisTools(server as unknown as McpServer, reader);
  });

  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    ['list_objects', {}, { count: 1, objects: ['Sprite'], filtered: false }],
    ['list_eventsheets', {}, { count: 1, eventSheets: ['MainSheet'] }],
    ['list_layouts', {}, { count: 1, layouts: ['Layout 1'] }],
    ['list_families', {}, { count: 0, families: [] }],
    ['get_object_details', { name: 'Sprite' }, { name: 'Sprite', 'plugin-id': 'Sprite' }],
    ['get_eventsheet_details', { name: 'MainSheet' }, { name: 'MainSheet', sid: 400000000000004 }],
    ['get_layout_details', { name: 'Layout 1' }, { name: 'Layout 1', eventSheet: 'MainSheet' }],
    ['search_objects', { pattern: 'sprite' }, { pattern: 'sprite', count: 1, results: ['Sprite'] }],
    ['get_project_summary', {}, { project: { name: 'TestProject' }, statistics: { objectTypes: 1, eventSheets: 1, layouts: 1 } }],
    ['get_eventsheet_flow', { format: 'json' }, { format: 'json', layoutBindings: { 'Layout 1': 'MainSheet' }, warnings: [] }],
    ['get_function_map', {}, { functions: [], summary: { totalFunctions: 0, totalCallSites: 0 } }],
    ['get_object_dependencies', { object: 'Sprite' }, { object: { objectName: 'Sprite', referenceCount: 2 } }],
    ['find_orphaned_objects', {}, { orphanedObjects: [], count: 0, totalObjects: 1 }],
    ['get_asset_usage', {}, { summary: { totalAssets: 2, usedCount: 1, notAnalysedCount: 1 } }],
    ['analyze_performance', {}, { summary: { critical: 0, warning: 0, info: 0 }, issues: [] }],
    ['validate_project', {}, { valid: true, complete: true, summary: { errors: 0, warnings: 0, unscanned: 0 }, unscannedFiles: [] }],
    ['get_group_settings', {}, { groups: [], summary: { totalGroups: 0 }, bySheet: {} }],
    ['find_runtime_traps', {}, { summary: { warning: 0, sheetsScanned: 1 }, issues: [] }],
  ])('%s keeps its data without JSON indentation', async (tool, args, expected) => {
    const result = await server.callTool(tool, args);
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).not.toMatch(/[\r\n\t]/);
    expect(JSON.parse(text)).toMatchObject(expected);
    expect(JSON.parse(text).editorNote).toBeUndefined();
  });

  it.each(['get_object_details', 'find_runtime_traps'])('%s retains useful errors', async tool => {
    const args = tool === 'get_object_details' ? { name: 'Missing' } : { eventsheet: 'Missing' };
    const result = await server.callTool(tool, args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Missing');
    expect(result.content[0].text).toMatch(/not found|no such file/i);
  });
});
