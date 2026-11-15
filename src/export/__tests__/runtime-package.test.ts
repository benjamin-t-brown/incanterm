import { expect, it } from 'vitest';
import { createRuntimePackage } from '../runtime-package.js';

function createPackageFixture() {
  return {
    pkg: {
      name: 'engine',
      version: '1.2.3',
      dependencies: { runtime: '^1.0.0' },
      devDependencies: { compiler: '^2.0.0' },
    },
    lock: {
      name: 'engine',
      version: '1.2.3',
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { runtime: '^1.0.0' }, devDependencies: { compiler: '^2.0.0' } },
        'node_modules/runtime': {
          version: '1.0.0',
          integrity: 'runtime-hash',
          dependencies: { shared: '^1.0.0' },
        },
        'node_modules/shared': { version: '1.0.0', integrity: 'shared-hash', devOptional: true },
        'node_modules/compiler': { version: '2.0.0', dev: true },
      },
    },
  };
}

it('creates a web-only runtime package and preserves locked production dependencies without mutating inputs', () => {
  const fixture = createPackageFixture();
  const original = structuredClone(fixture);
  const result = createRuntimePackage(fixture.pkg, fixture.lock);
  expect(result.pkg.scripts.start).toBe('node dist/server.js --project ./game --no-ssh');
  expect(result.pkg).not.toHaveProperty('devDependencies');
  expect(result.pkg.dependencies).toEqual({ runtime: '^1.0.0' });
  expect(Object.keys(result.lock.packages)).toEqual([
    '',
    'node_modules/runtime',
    'node_modules/shared',
  ]);
  expect(result.lock.packages['node_modules/runtime']).toEqual(
    fixture.lock.packages['node_modules/runtime'],
  );
  expect(result.lock.packages['']).not.toHaveProperty('devDependencies');
  expect(fixture).toEqual(original);
});

it.each(['file:../local', 'workspace:*', 'link:../local', '../local', '/local'])(
  'rejects nonportable runtime dependencies %s',
  (version) => {
    const fixture = createPackageFixture();
    fixture.pkg.dependencies.runtime = version;
    expect(() => createRuntimePackage(fixture.pkg, fixture.lock)).toThrow('not portable');
  },
);

it('rejects an incomplete or unsupported lockfile', () => {
  const fixture = createPackageFixture();
  expect(() => createRuntimePackage(fixture.pkg, { ...fixture.lock, lockfileVersion: 1 })).toThrow(
    'lockfile',
  );
  expect(() => createRuntimePackage(fixture.pkg, { ...fixture.lock, packages: {} })).toThrow(
    'missing',
  );
});

it('rejects links in the production lock graph', () => {
  const fixture = createPackageFixture();
  const lock = {
    ...fixture.lock,
    packages: {
      ...fixture.lock.packages,
      'node_modules/runtime': { link: true, resolved: '../runtime' },
    },
  };
  expect(() => createRuntimePackage(fixture.pkg, lock)).toThrow('not portable');
});

it('rejects out-of-sync runtime dependency declarations before producing a release', () => {
  const fixture = createPackageFixture();
  fixture.pkg.dependencies.runtime = '^9.0.0';
  expect(() => createRuntimePackage(fixture.pkg, fixture.lock)).toThrow('out of sync');
});
