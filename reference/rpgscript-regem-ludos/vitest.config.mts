import { defineConfig, configDefaults } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'path';
import { readdirSync } from 'fs';
import react from '@vitejs/plugin-react';
import GithubActionsReporter from 'vitest-github-actions-reporter';

const absolutePathAliases: Record<string, string> = {};

export default defineConfig((...args) => {
  const rootPath = './';

  const srcPath = path.resolve('./src/');
  const srcRootContent = readdirSync(srcPath, { withFileTypes: true }).map(
    dirent => dirent.name.replace(/(\.ts){1}(x?)/, '')
  );

  srcRootContent.forEach(directory => {
    absolutePathAliases[directory] = path.join(srcPath, directory);
  });

  const config = {
    plugins: [react(), tsconfigPaths()],
    publicDir: path.resolve(__dirname, 'res'),
    resolve: {
      alias: {
        // src: path.resolve('src/'),
        // ...absolutePathAliases,
        // 'view/style': path.resolve('src/view/styleTest'),
      },
    },

    test: {
      globals: true,
      environment: 'happy-dom',
      setupFiles: ['src/__tests__/setup.ts'],
      reporters: process.env.GITHUB_ACTIONS
        ? new GithubActionsReporter()
        : 'default',
      include: ['src/__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
      exclude: [
        ...configDefaults.exclude,
        '**/node_modules_win32/**',
        '**/node_modules/**',
        '**/anims/**',
        '**/loopy/**/',
        '**/iframes/**',
        '**/scratch/**',
        '**/res/**',
        '**/rpgscript-vs/**',
        '**/rpgscript-format/**',
      ],
      coverage: {
        provider: 'istanbul',
        transformMode: 'web',
        reporter: ['text-summary', 'lcov'],
        exclude: [
          'src/view/icons/**.*',
          'src/lib/**.*',
          'src/__tests__/*',
          'iframes/**/**.*',
          'src/db/**/**.*',
          'scratch/**/**.*',
          'target/**/**.*',
          '**/node_modules_win32/**',
          '**/node_modules/**',
          '**/anims/**',
          '**/loopy/**/',
          '**/iframes/**',
          '**/scratch/**',
          '**/res/**',
          '**/rpgscript-vs/**',
          '**/rpgscript-format/**',
        ],
      },
    },
    directory: 'src/__tests__',
    root: __dirname,
  };
  return config as any;
});
