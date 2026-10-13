import type { Construct3ProjectReader } from './project-reader.js';
import { TRANSITIONS_DIR, transitionsFolderIndex, type ProjectFolderNode } from './timeline-folders.js';

// r495.2 Hce.hhe accepts these selector IDs. Runtime aliases (e.g. linear) are not Editor selector IDs.
export const BUILTIN_EASE_IDS: ReadonlySet<string> = new Set([
  'default', 'noease', 'easeinsine', 'easeoutsine', 'easeinoutsine', 'easeinelastic', 'easeoutelastic', 'easeinoutelastic',
  'easeinback', 'easeoutback', 'easeinoutback', 'easeinbounce', 'easeoutbounce', 'easeinoutbounce',
  'easeincubic', 'easeoutcubic', 'easeinoutcubic', 'easeinquad', 'easeoutquad', 'easeinoutquad',
  'easeinquart', 'easeoutquart', 'easeinoutquart', 'easeinquint', 'easeoutquint', 'easeinoutquint',
  'easeincirc', 'easeoutcirc', 'easeinoutcirc', 'easeinexpo', 'easeoutexpo', 'easeinoutexpo',
]);

export type EaseReferenceProblem = (value: unknown) => { severity: 'error' | 'warning'; message: string } | undefined;

/** Checks registered curve names and readable backing JSON, not the curve's keyframe semantics. */
export async function loadEaseReferenceCheck(reader: Construct3ProjectReader): Promise<EaseReferenceProblem> {
  const project = reader.getProject();
  const customNames = new Set<string>();
  const unreadable = new Map<string, string>();
  const rootIndex = transitionsFolderIndex(project.timelines);
  let incomplete = false;
  let nodes = 0;
  const walk = async (folder: ProjectFolderNode, prefix: string, depth: number): Promise<void> => {
    if (depth > 20 || ++nodes > 5000) { incomplete = true; return; }
    if (Array.isArray(folder.items)) for (const item of folder.items) {
      if (++nodes > 5000) { incomplete = true; return; }
      if (typeof item !== 'string') continue;
      const path = project.savedWithRelease < 30900 ? `${TRANSITIONS_DIR}/${item.toLowerCase()}.json` : `${prefix}/${item}.json`;
      try {
        const curve = JSON.parse(await reader.readDataFileText('timelines', path));
        if (!curve || typeof curve.name !== 'string' || !curve.name) throw new Error('Missing custom ease name');
        customNames.add(curve.name);
      } catch {
        unreadable.set(item, `Custom ease "${item}" could not be read from timelines/${path}; restore a readable JSON file with its saved name.`);
      }
    }
    if (Array.isArray(folder.subfolders)) for (const child of folder.subfolders) {
      if (child && typeof child === 'object' && typeof child.name === 'string') await walk(child, `${prefix}/${child.name}`, depth + 1);
    }
  };
  if (rootIndex >= 0) await walk(project.timelines.subfolders[rootIndex], TRANSITIONS_DIR, 0);
  return value => {
    const error = (message: string) => ({ severity: 'error' as const, message });
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const reference = value as Record<string, unknown>;
      if (typeof reference.name === 'string' && customNames.has(reference.name)) return undefined;
      // T7.BO imports embedded curves only when name lookup fails; the first imported curve supplies the resulting name.
      if (typeof reference.name === 'string' && Array.isArray(reference.json) && reference.json.length > 0 && reference.json.every(entry =>
        entry && typeof entry === 'object' && Array.isArray(entry.folders) && entry.folders.every((folder: unknown) => typeof folder === 'string') &&
        entry.json && typeof entry.json === 'object' && typeof entry.json.name === 'string')) {
        return { severity: 'warning', message: `Embedded custom ease "${reference.name}" is preserved for Editor import; static reference checks do not validate curve/keyframe semantics. Verify its Editor save/read.` };
      }
      return error(`Custom ease "${String(reference.name)}" does not resolve to a registered curve or contain an embedded {name, json: [{folders, json}]} import.`);
    }
    if (typeof value !== 'string') return error('Ease reference requires a serialized selector string or custom ease object.');
    if (BUILTIN_EASE_IDS.has(value) || customNames.has(value)) return undefined;
    if (unreadable.has(value)) return error(unreadable.get(value)!);
    if (incomplete) return error(`Ease "${value}" could not be verified: the custom ease registry exceeds the scan limits.`);
    return error(`Ease "${value}" is neither a canonical Editor ease ID nor a registered custom ease with a readable file. ` +
      'Use "noease" for linear interpolation, or register a custom ease with this exact name. An unresolved selector can prevent Editor saving.');
  };
}
