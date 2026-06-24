// Run the Kafka plugin standalone with proper SDK context
import { createOpencodeClient } from '@opencode-ai/sdk';
import { Kafka } from 'kafkajs';
import { parseConfigV003 } from '../dist/src/core/config.js';
import { startConsumer } from '../dist/src/kafka/consumer.js';
import { OpenCodeAgentAdapter } from '../dist/src/opencode/OpenCodeAgentAdapter.js';

const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL || 'http://localhost:8089';
const KAFKA_ROUTER_CONFIG = process.env.KAFKA_ROUTER_CONFIG || '.opencode/kafka-router.json';

async function main() {
  console.log('Starting Kafka Plugin...');
  console.log('OpenCode URL:', OPENCODE_BASE_URL);
  console.log('Config file:', KAFKA_ROUTER_CONFIG);

  // Create OpenCode SDK client
  const client = createOpencodeClient({
    directory: process.cwd(),
    baseUrl: OPENCODE_BASE_URL
  });

  console.log('OpenCode client initialized');

  // Parse config
  const config = parseConfigV003(KAFKA_ROUTER_CONFIG);
  console.log('Config parsed:', config.topics, config.rules.length, 'rules');

  // Create agent adapter
  const agent = new OpenCodeAgentAdapter(client);
  console.log('Agent adapter created');

  // Start consumer
  console.log('Starting Kafka consumer...');
  await startConsumer(config, agent);
  console.log('Consumer started, waiting for messages...');

  // Keep running
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});