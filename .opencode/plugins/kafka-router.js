// Kafka Router OpenCode Plugin
// Loads and executes the built plugin from dist/
// Uses dynamic import() for ESM compatibility with OpenCode

const path = require('path');
const { fileURLToPath } = require('url');

export default async function plugin(context) {
  // Dynamic import for ESM compatibility
  // Path from .opencode/plugins/kafka-router.js → dist/src/index.js (project root)
  const mod = await import('../dist/src/index.js');
  return mod.default(context);
}