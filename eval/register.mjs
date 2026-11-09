import { registerHooks } from 'node:module';

// Platform adapters only. Business logic is imported directly from src/.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'expo')
      return {
        url: `data:text/javascript,export function requireNativeModule(name) { throw new Error('Native module ' + name + ' requires device evaluation.'); }`,
        shortCircuit: true,
      };
    if (specifier === 'expo-sqlite')
      return {
        url: new URL('./node/sqlite.mjs', import.meta.url).href,
        shortCircuit: true,
      };
    if (specifier === 'expo/fetch')
      return {
        url: 'data:text/javascript,export const fetch = globalThis.fetch;',
        shortCircuit: true,
      };
    if (specifier.startsWith('.') && !/\.[a-z]+$/.test(specifier))
      specifier += '.ts';
    const result = nextResolve(specifier, context);
    return result.url.endsWith('.ts')
      ? { ...result, format: 'module-typescript' }
      : result;
  },
});
