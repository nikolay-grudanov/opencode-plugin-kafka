// Kafka Router OpenCode Plugin
// Loads and executes the built plugin from dist/
// Uses dynamic import() for ESM compatibility with OpenCode
//
// Path resolution:
//   This file lives at: <project>/.opencode/plugins/kafka-router.js
//   The plugin entry compiles to: <project>/dist/src/index.js
//   (tsconfig: outDir=./dist, rootDir=./, so src/index.ts → dist/src/index.js)
//   From .opencode/plugins/ we need to go up 2 levels to reach <project>/,
//   then into dist/src/index.js.

export default async function plugin(context) {
  // Dynamic import for ESM compatibility
  const mod = await import('../../dist/src/index.js');
  return mod.default(context);
}