import { access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKFLOW_RELATIVE_PATH = path.join(
  'src',
  'BuiltinExtensions',
  'ComfyUIBackend',
  'ExampleWorkflows',
);

async function exists(candidate) {
  try {
    await access(candidate);
    return true;
  }
  catch {
    return false;
  }
}

export async function findRepoRoot(start = process.cwd()) {
  const explicit = process.env.SWARMUI_REPO_ROOT?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }

  const starts = [path.resolve(start), path.resolve(MODULE_DIR)];
  for (const initial of starts) {
    let current = initial;
    while (true) {
      const solution = path.join(current, 'SwarmUI.sln');
      const workflows = path.join(current, DEFAULT_WORKFLOW_RELATIVE_PATH);
      if (await exists(solution) && await exists(workflows)) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  throw new Error(
    'Unable to locate the SwarmUI repository. Set SWARMUI_REPO_ROOT to the repository root.',
  );
}

export async function resolveWorkflowRoot() {
  const explicit = process.env.SWARMUI_WORKFLOW_ROOT?.trim();
  const candidate = explicit
    ? path.resolve(explicit)
    : path.join(await findRepoRoot(), DEFAULT_WORKFLOW_RELATIVE_PATH);

  const resolved = await realpath(candidate).catch(() => null);
  if (!resolved) {
    throw new Error(`Workflow root does not exist: ${candidate}`);
  }
  return resolved;
}

export async function resolveInside(root, candidate) {
  const rootReal = await realpath(root);
  const candidateReal = await realpath(candidate);
  if (candidateReal !== rootReal && !candidateReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`Resolved path escapes workflow root: ${candidate}`);
  }
  return candidateReal;
}

export function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

export function stripJsonExtension(relativePath) {
  return relativePath.replace(/\.json$/i, '');
}
