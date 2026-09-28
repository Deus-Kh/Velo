import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * T4.1 — the production process runs the compiled build. This pins the
 * manifest so a future edit cannot quietly put ts-node or nodemon back on
 * the production path.
 */
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  main: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines?: { node?: string };
};

describe('T4.1 production build', () => {
  it('npm start runs dist/index.js with no TypeScript loader and no watcher', () => {
    expect(pkg.scripts.start).toBe('node dist/index.js');
    expect(pkg.scripts.start).not.toMatch(/ts-node|nodemon|tsx/);
    expect(pkg.main).toBe('dist/index.js');
    expect(pkg.scripts.build).toBe('tsc -p tsconfig.build.json');
  });

  it('nodemon and the TypeScript loaders are development-only dependencies', () => {
    for (const name of ['nodemon', 'ts-node-dev', 'typescript', 'cross-env']) {
      expect(pkg.dependencies[name], name + ' must not ship to production').toBeUndefined();
      expect(pkg.devDependencies[name], name + ' stays available for development').toBeDefined();
    }
    expect(pkg.engines?.node).toMatch(/>=20/);
  });

  it('the build config emits src/ to dist/ and excludes the tests', () => {
    const raw = readFileSync(join(root, 'tsconfig.build.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const cfg = JSON.parse(raw) as { extends: string; compilerOptions: Record<string, unknown>; exclude: string[] };
    expect(cfg.extends).toBe('./tsconfig.json');
    expect(cfg.compilerOptions.noEmit).toBe(false);
    expect(cfg.compilerOptions.outDir).toBe('dist');
    expect(cfg.compilerOptions.rootDir).toBe('src');
    expect(cfg.exclude).toContain('test');
    expect(existsSync(join(root, 'src', 'index.ts'))).toBe(true);
  });
});
