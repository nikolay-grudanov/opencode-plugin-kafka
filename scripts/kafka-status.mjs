#!/usr/bin/env node
/**
 * Kafka Environment Status Check
 * 
 * Quick check to verify Kafka is working
 * 
 * Usage: node scripts/kafka-status.mjs
 */

import { Kafka } from 'kafkajs';

const BROKERS = process.env.KAFKA_BROKERS?.split(',') || ['localhost:9093'];

async function main() {
  console.log('=========================================');
  console.log('  Kafka Environment Status');
  console.log('=========================================\n');
  
  const kafka = new Kafka({
    clientId: 'kafka-status-check',
    brokers: BROKERS,
  });
  
  const admin = kafka.admin();
  
  try {
    // Connect to Kafka
    await admin.connect();
    console.log('✅ Connected to Kafka');
    
    // Check broker
    const cluster = await admin.describeCluster();
    console.log(`   Broker ID: ${cluster.clusterId}`);
    console.log(`   Controller: ${cluster.controller?.host}:${cluster.controller?.port}`);
    
    // List topics
    const topics = await admin.listTopics();
    console.log(`\n✅ Topics (${topics.length}):`);
    topics.sort().forEach(t => console.log(`   - ${t}`));
    
    // Check consumer groups
    const groups = await admin.listGroups();
    if (groups && Array.isArray(groups)) {
      console.log(`\n✅ Consumer Groups (${groups.length}):`);
      groups.forEach(g => console.log(`   - ${g.groupId} (${g.type})`));
    } else {
      console.log('\n⚪ No consumer groups');
    }
    
    await admin.disconnect();
    
    console.log('\n=========================================');
    console.log('  Status: HEALTHY');
    console.log('=========================================');
    
  } catch (error) {
    console.log('\n❌ Error connecting to Kafka:');
    console.log(`   ${error.message}`);
    console.log('\n=========================================');
    console.log('  Status: UNHEALTHY');
    console.log('=========================================');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});