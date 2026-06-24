/**
 * Demo script for SSL connection to Kafka
 *
 * This script demonstrates:
 * 1. SSL connection to Kafka via SSL port 9095
 * 2. Using PEM certificates for client authentication
 * 3. Producer/consumer with SSL
 *
 * Usage:
 *   # With SSL on port 9095 (using existing PEM certificates)
 *   node scripts/demo-ssl.mjs
 *   
 *   # Or with env vars:
 *   KAFKA_SSL=true \
 *   KAFKA_SSL_CA=./kafka-ssl/ca.pem \
 *   KAFKA_SSL_CERT=./kafka-ssl/client.pem \
 *   KAFKA_SSL_KEY=./kafka-ssl/client-key.pem \
 *   node scripts/demo-ssl.mjs
 */

import { createKafkaClient } from '../dist/src/kafka/client.js';
import { createConsumer, createDlqProducer, createResponseProducer } from '../dist/src/kafka/client.js';

const INPUT_TOPIC = 'demo-ssl-input';
const RESPONSE_TOPIC = 'demo-ssl-response';
const DLQ_TOPIC = 'demo-ssl-dlq';
const GROUP_ID = 'demo-ssl-group';

// Default SSL configuration
const DEFAULT_SSL_BROKERS = 'localhost:9095';
const DEFAULT_PLAINTEXT_BROKERS = 'localhost:9092';

/**
 * Formats a log message with timestamp
 */
function log(message, ...args) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${message}`, ...args);
}

/**
 * Main function
 */
async function main() {
  log('='.repeat(60));
  log('SSL Kafka Demo - opencode-plugin-kafka');
  log('='.repeat(60));

  // Determine mode
  const useSSL = process.argv.includes('--ssl') || process.env.KAFKA_SSL === 'true';
  const brokers = useSSL ? DEFAULT_SSL_BROKERS : DEFAULT_PLAINTEXT_BROKERS;

  log(`Mode: ${useSSL ? 'SSL (TLS)' : 'Plaintext'}`);
  log(`Brokers: ${brokers}`);

  // ===== STEP 1: Setup environment =====
  log('-'.repeat(60));
  log('STEP 1: Setting up environment variables...');

  process.env.KAFKA_BROKERS = brokers;
  process.env.KAFKA_CLIENT_ID = 'demo-ssl-client';
  process.env.KAFKA_GROUP_ID = GROUP_ID;
  process.env.KAFKA_DLQ_TOPIC = DLQ_TOPIC;

  if (useSSL) {
    process.env.KAFKA_SSL = 'true';
    // Use existing PEM certificates from kafka-ssl/
    process.env.KAFKA_SSL_CA = process.env.KAFKA_SSL_CA || './kafka-ssl/ca.pem';
    process.env.KAFKA_SSL_CERT = process.env.KAFKA_SSL_CERT || './kafka-ssl/client.pem';
    process.env.KAFKA_SSL_KEY = process.env.KAFKA_SSL_KEY || './kafka-ssl/client-key.pem';
    
    log(`SSL enabled`);
    log(`  CA: ${process.env.KAFKA_SSL_CA}`);
    log(`  CERT: ${process.env.KAFKA_SSL_CERT}`);
    log(`  KEY: ${process.env.KAFKA_SSL_KEY}`);
  } else {
    process.env.KAFKA_SSL = 'false';
    log('SSL disabled (plaintext mode)');
  }

  // ===== STEP 2: Create Kafka client =====
  log('-'.repeat(60));
  log('STEP 2: Creating Kafka client...');

  let kafka;
  let validatedEnv;

  try {
    const result = await createKafkaClient(process.env);
    kafka = result.kafka;
    validatedEnv = result.validatedEnv;
    log('✓ Kafka client created');
    log(`  Client ID: ${validatedEnv.KAFKA_CLIENT_ID}`);
    log(`  Group ID: ${validatedEnv.KAFKA_GROUP_ID}`);
    log(`  SSL: ${validatedEnv.KAFKA_SSL ? 'enabled' : 'disabled'}`);
    
    if (validatedEnv.KAFKA_SSL_CA) {
      log(`  SSL CA: ${validatedEnv.KAFKA_SSL_CA}`);
    }
    if (validatedEnv.KAFKA_SSL_CERT) {
      log(`  SSL CERT: ${validatedEnv.KAFKA_SSL_CERT}`);
    }
  } catch (error) {
    log(`✗ Error creating client: ${error.message}`);
    process.exit(1);
  }

  // ===== STEP 3: Create producers =====
  log('-'.repeat(60));
  log('STEP 3: Creating producers...');

  const dlqProducer = createDlqProducer(kafka);
  const responseProducer = createResponseProducer(kafka);
  log('✓ DLQ producer created');
  log('✓ Response producer created');

  // ===== STEP 4: Create consumer =====
  log('-'.repeat(60));
  log('STEP 4: Creating consumer...');

  const consumer = createConsumer(kafka, GROUP_ID);
  log(`✓ Consumer created (groupId: ${GROUP_ID})`);

  // ===== STEP 5: Test connection =====
  log('-'.repeat(60));
  log('STEP 5: Testing SSL connection...');

  try {
    // Try to connect to verify SSL handshake
    log('Connecting to Kafka...');
    await consumer.connect();
    log('✓ Consumer connected - SSL handshake successful!');
    
    await dlqProducer.connect();
    log('✓ DLQ producer connected');
    
    await responseProducer.connect();
    log('✓ Response producer connected');
    
    // Test admin operations
    const admin = kafka.admin();
    await admin.connect();
    log('✓ Admin client connected');
    
    // List topics
    const topics = await admin.listTopics();
    log(`  Found ${topics.length} topic(s)`);
    
    // Disconnect
    await admin.disconnect();
    await consumer.disconnect();
    await dlqProducer.disconnect();
    await responseProducer.disconnect();
    log('✓ All connections closed');
    
  } catch (error) {
    // If connection fails, provide helpful message
    const errMsg = error.message || String(error);
    
    if (errMsg.includes('ECONNREFUSED')) {
      log('✗ Connection refused - Kafka may not be running');
      log('  Start Kafka with:');
      log('    docker compose -f docker-compose.kafka.yml up -d');
      log('  Then wait for healthy status:');
      log('    docker compose -f docker-compose.kafka.yml ps');
    } else if (errMsg.includes('SSL') || errMsg.includes('TLS') || errMsg.includes('certificate')) {
      log(`⚠ SSL connection issue: ${errMsg}`);
      log('  For development, you may need to:');
      log('  - Use valid certificates');
      log('  - Or use PLAINTEXT mode with --no-ssl flag');
    } else {
      log(`⚠ Connection error: ${errMsg}`);
    }
    
    log('');
    log('For plaintext mode, run:');
    log('  node scripts/demo-ssl.mjs --no-ssl');
    log('');
    log('Or with environment:');
    log('  KAFKA_SSL=false node scripts/demo-ssl.mjs');
  }

  // ===== RESULTS =====
  log('='.repeat(60));
  log('RESULT:');
  log(`  Mode: ${useSSL ? 'SSL (TLS)' : 'Plaintext'}`);
  log(`  Brokers: ${brokers}`);
  log(`  Client ID: ${validatedEnv.KAFKA_CLIENT_ID}`);
  log(`  Group ID: ${validatedEnv.KAFKA_GROUP_ID}`);
  log(`  SSL: ${validatedEnv.KAFKA_SSL ? 'enabled' : 'disabled'}`);
  
  if (useSSL) {
    log('');
    log('Environment variables for SSL:');
    log('  export KAFKA_BROKERS=localhost:9095');
    log('  export KAFKA_SSL=true');
    log('  export KAFKA_SSL_CA=./kafka-ssl/ca.pem');
    log('  export KAFKA_SSL_CERT=./kafka-ssl/client.pem');
    log('  export KAFKA_SSL_KEY=./kafka-ssl/client-key.pem');
  }
  
  log('');
  log('Done ✓');
}

main().catch((error) => {
  log(`Fatal error: ${error.message}`);
  log(error.stack);
  process.exit(1);
});