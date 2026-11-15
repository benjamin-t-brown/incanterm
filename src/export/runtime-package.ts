type JsonObject = Record<string, unknown>;

function getObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as JsonObject;
}

function getDependencies(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(getObject(value ?? {}, 'Dependencies'))) {
    if (typeof version !== 'string' || /^(?:file:|link:|workspace:|[./\\])/.test(version))
      throw new Error(`Runtime dependency ${name} is not portable`);
    result[name] = version;
  }
  return result;
}

/** Retain npm's locked production graph, not the engine's build and editor dependencies. */
export function createRuntimePackage(packageValue: unknown, lockValue: unknown) {
  const engine = getObject(packageValue, 'Engine package');
  const lock = getObject(lockValue, 'Engine lockfile');
  if (lock.lockfileVersion !== 2 && lock.lockfileVersion !== 3)
    throw new Error('Export requires an npm lockfile with a packages graph');
  const dependencies = getDependencies(engine.dependencies);
  const optionalDependencies = getDependencies(engine.optionalDependencies);
  const lockedPackages = getObject(lock.packages, 'Locked packages');
  if (!lockedPackages['']) throw new Error('The engine lockfile is missing its root package');
  const lockedRoot = getObject(lockedPackages[''], 'Locked root package');
  for (const [field, declared] of [
    ['dependencies', dependencies],
    ['optionalDependencies', optionalDependencies],
  ] as const) {
    const locked = getDependencies(lockedRoot[field]);
    if (
      Object.keys(declared).length !== Object.keys(locked).length ||
      Object.entries(declared).some(([name, version]) => locked[name] !== version)
    )
      throw new Error(`Engine package.json and package-lock.json ${field} are out of sync`);
  }
  const pkg = {
    name: 'incanterm-game',
    version: typeof engine.version === 'string' ? engine.version : '0.0.0',
    private: true,
    type: 'module',
    engines: { node: '>=22' },
    scripts: { start: 'node dist/server.js --project ./game --no-ssh' },
    dependencies,
    ...(Object.keys(optionalDependencies).length ? { optionalDependencies } : {}),
  };
  const packages: Record<string, JsonObject> = {
    '': {
      name: pkg.name,
      version: pkg.version,
      dependencies,
      engines: pkg.engines,
      ...(Object.keys(optionalDependencies).length ? { optionalDependencies } : {}),
    },
  };
  for (const [location, value] of Object.entries(lockedPackages)) {
    if (!location) continue;
    const entry = getObject(value, `Locked package ${location}`);
    if (entry.dev === true) continue;
    if (
      entry.link === true ||
      (typeof entry.resolved === 'string' && entry.resolved.startsWith('file:'))
    )
      throw new Error(`Locked runtime package ${location} is not portable`);
    packages[location] = entry;
  }
  for (const name of [...Object.keys(dependencies), ...Object.keys(optionalDependencies)])
    if (!packages[`node_modules/${name}`])
      throw new Error(`Runtime dependency ${name} is missing from the engine lockfile`);
  return {
    pkg,
    lock: {
      name: pkg.name,
      version: pkg.version,
      lockfileVersion: lock.lockfileVersion,
      requires: true,
      packages,
    },
  };
}
