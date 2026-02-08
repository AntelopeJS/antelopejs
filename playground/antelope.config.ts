import { defineConfig } from '@antelopejs/core/config';

export default defineConfig({
  name: 'playground',
  modules: {
    'module-a': {
      source: { type: 'local', path: './modules/module-a', installCommand: ['npx tsc'] },
      config: { prefix: 'Hello' },
    },
    'module-b': {
      source: { type: 'local', path: './modules/module-b', installCommand: ['npx tsc'] },
      config: { target: 'World' },
    },
  },
});
