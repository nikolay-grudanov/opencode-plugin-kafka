// Create demo topics with realistic data
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  clientId: 'demo-topics-creator',
  brokers: ['localhost:9093'], // External PLAINTEXT
});

const topics = {
  'demo.orders': {
    numPartitions: 5,
    replicationFactor: 1,
  },
  'demo.shipments': {
    numPartitions: 3,
    replicationFactor: 1,
  },
  'demo.notifications': {
    numPartitions: 2,
    replicationFactor: 1,
  },
  'demo.feedback': {
    numPartitions: 2,
    replicationFactor: 1,
  },
};

// Realistic demo messages
const demoOrders = [
  { orderId: 'ORD-001', customer: 'Alice Johnson', amount: 150.00, status: 'pending' },
  { orderId: 'ORD-002', customer: 'Bob Smith', amount: 89.99, status: 'confirmed' },
  { orderId: 'ORD-003', customer: 'Carol White', amount: 299.50, status: 'processing' },
  { orderId: 'ORD-004', customer: 'David Brown', amount: 45.00, status: 'shipped' },
  { orderId: 'ORD-005', customer: 'Emma Davis', amount: 175.25, status: 'delivered' },
  { orderId: 'ORD-006', customer: 'Frank Miller', amount: 520.00, status: 'pending' },
  { orderId: 'ORD-007', customer: 'Grace Lee', amount: 99.99, status: 'confirmed' },
  { orderId: 'ORD-008', customer: 'Henry Wilson', amount: 310.00, status: 'processing' },
  { orderId: 'ORD-009', customer: 'Ivy Taylor', amount: 65.50, status: 'shipped' },
  { orderId: 'ORD-010', customer: 'Jack Anderson', amount: 450.00, status: 'delivered' },
  { orderId: 'ORD-011', customer: 'Karen Martinez', amount: 125.00, status: 'pending' },
  { orderId: 'ORD-012', customer: 'Leo Garcia', amount: 78.00, status: 'confirmed' },
  { orderId: 'ORD-013', customer: 'Mia Robinson', amount: 199.99, status: 'processing' },
  { orderId: 'ORD-014', customer: 'Nathan Clark', amount: 85.00, status: 'shipped' },
  { orderId: 'ORD-015', customer: 'Olivia Lewis', amount: 275.00, status: 'delivered' },
  { orderId: 'ORD-016', customer: 'Paul Walker', amount: 42.50, status: 'pending' },
  { orderId: 'ORD-017', customer: 'Quinn Hall', amount: 330.00, status: 'confirmed' },
  { orderId: 'ORD-018', customer: 'Ruby Young', amount: 159.99, status: 'processing' },
  { orderId: 'ORD-019', customer: 'Sam King', amount: 95.00, status: 'shipped' },
  { orderId: 'ORD-020', customer: 'Tina Wright', amount: 410.00, status: 'delivered' },
];

const demoShipments = [
  { shipmentId: 'SHP-001', orderId: 'ORD-001', carrier: 'FedEx', status: 'preparing' },
  { shipmentId: 'SHP-002', orderId: 'ORD-002', carrier: 'UPS', status: 'in_transit' },
  { shipmentId: 'SHP-003', orderId: 'ORD-003', carrier: 'DHL', status: 'out_for_delivery' },
  { shipmentId: 'SHP-004', orderId: 'ORD-004', carrier: 'USPS', status: 'delivered' },
  { shipmentId: 'SHP-005', orderId: 'ORD-005', carrier: 'FedEx', status: 'delivered' },
  { shipmentId: 'SHP-006', orderId: 'ORD-006', carrier: 'UPS', status: 'preparing' },
  { shipmentId: 'SHP-007', orderId: 'ORD-007', carrier: 'DHL', status: 'in_transit' },
  { shipmentId: 'SHP-008', orderId: 'ORD-008', carrier: 'USPS', status: 'out_for_delivery' },
  { shipmentId: 'SHP-009', orderId: 'ORD-009', carrier: 'FedEx', status: 'delivered' },
  { shipmentId: 'SHP-010', orderId: 'ORD-010', carrier: 'UPS', status: 'delivered' },
  { shipmentId: 'SHP-011', orderId: 'ORD-011', carrier: 'DHL', status: 'preparing' },
  { shipmentId: 'SHP-012', orderId: 'ORD-012', carrier: 'USPS', status: 'in_transit' },
  { shipmentId: 'SHP-013', orderId: 'ORD-013', carrier: 'FedEx', status: 'out_for_delivery' },
  { shipmentId: 'SHP-014', orderId: 'ORD-014', carrier: 'UPS', status: 'delivered' },
  { shipmentId: 'SHP-015', orderId: 'ORD-015', carrier: 'DHL', status: 'delivered' },
];

const demoNotifications = [
  { userId: 'USR-001', type: 'order_placed', message: 'Your order ORD-001 has been placed successfully', timestamp: '2026-05-19T10:00:00Z' },
  { userId: 'USR-002', type: 'order_confirmed', message: 'Your order ORD-002 has been confirmed', timestamp: '2026-05-19T10:15:00Z' },
  { userId: 'USR-003', type: 'payment_received', message: 'Payment of $299.50 received for order ORD-003', timestamp: '2026-05-19T10:30:00Z' },
  { userId: 'USR-004', type: 'shipment_shipped', message: 'Your order ORD-004 has been shipped via USPS', timestamp: '2026-05-19T11:00:00Z' },
  { userId: 'USR-005', type: 'delivery_complete', message: 'Your order ORD-005 has been delivered', timestamp: '2026-05-19T11:30:00Z' },
  { userId: 'USR-001', type: 'order_placed', message: 'Your order ORD-006 has been placed successfully', timestamp: '2026-05-19T12:00:00Z' },
  { userId: 'USR-006', type: 'order_confirmed', message: 'Your order ORD-007 has been confirmed', timestamp: '2026-05-19T12:15:00Z' },
  { userId: 'USR-007', type: 'payment_received', message: 'Payment of $310.00 received for order ORD-008', timestamp: '2026-05-19T12:30:00Z' },
  { userId: 'USR-008', type: 'shipment_shipped', message: 'Your order ORD-009 has been shipped via FedEx', timestamp: '2026-05-19T13:00:00Z' },
  { userId: 'USR-009', type: 'delivery_complete', message: 'Your order ORD-010 has been delivered', timestamp: '2026-05-19T13:30:00Z' },
  { userId: 'USR-010', type: 'order_placed', message: 'Your order ORD-011 has been placed successfully', timestamp: '2026-05-19T14:00:00Z' },
  { userId: 'USR-002', type: 'payment_received', message: 'Payment of $78.00 received for order ORD-012', timestamp: '2026-05-19T14:15:00Z' },
  { userId: 'USR-011', type: 'order_confirmed', message: 'Your order ORD-013 has been confirmed', timestamp: '2026-05-19T14:30:00Z' },
  { userId: 'USR-012', type: 'shipment_shipped', message: 'Your order ORD-014 has been shipped via UPS', timestamp: '2026-05-19T15:00:00Z' },
  { userId: 'USR-013', type: 'delivery_complete', message: 'Your order ORD-015 has been delivered', timestamp: '2026-05-19T15:30:00Z' },
  { userId: 'USR-014', type: 'promotion', message: 'Special discount: 20% off your next order!', timestamp: '2026-05-19T16:00:00Z' },
  { userId: 'USR-015', type: 'newsletter', message: 'Check out our new summer collection', timestamp: '2026-05-19T16:30:00Z' },
  { userId: 'USR-001', type: 'reminder', message: 'You have items waiting in your cart', timestamp: '2026-05-19T17:00:00Z' },
];

const demoFeedback = [
  { feedbackId: 'FBK-001', rating: 5, comment: 'Excellent product, fast shipping!' },
  { feedbackId: 'FBK-002', rating: 4, comment: 'Good quality, but delivery took longer than expected' },
  { feedbackId: 'FBK-003', rating: 5, comment: 'Amazing customer service, highly recommend!' },
  { feedbackId: 'FBK-004', rating: 3, comment: 'Product is okay, nothing special' },
  { feedbackId: 'FBK-005', rating: 2, comment: 'Product arrived damaged, but got replacement' },
  { feedbackId: 'FBK-006', rating: 5, comment: 'Perfect! Exactly what I was looking for' },
  { feedbackId: 'FBK-007', rating: 4, comment: 'Great value for money' },
  { feedbackId: 'FBK-008', rating: 1, comment: 'Terrible experience, would not buy again' },
  { feedbackId: 'FBK-009', rating: 5, comment: 'Exceeded my expectations!' },
  { feedbackId: 'FBK-010', rating: 4, comment: 'Good product, quick delivery' },
  { feedbackId: 'FBK-011', rating: 3, comment: 'Average experience' },
  { feedbackId: 'FBK-012', rating: 5, comment: 'Will definitely order again!' },
  { feedbackId: 'FBK-013', rating: 4, comment: 'Very satisfied with the purchase' },
  { feedbackId: 'FBK-014', rating: 2, comment: 'Product looks different from the picture' },
  { feedbackId: 'FBK-015', rating: 5, comment: 'Best online shopping experience ever' },
  { feedbackId: 'FBK-016', rating: 3, comment: 'Decent product, could be better' },
  { feedbackId: 'FBK-017', rating: 4, comment: 'Fast and reliable service' },
  { feedbackId: 'FBK-018', rating: 5, comment: 'Love it! Will recommend to friends' },
  { feedbackId: 'FBK-019', rating: 1, comment: 'Product never arrived, very disappointed' },
  { feedbackId: 'FBK-020', rating: 4, comment: 'Good overall, minor delay in shipping' },
];

const topicMessages = {
  'demo.orders': demoOrders,
  'demo.shipments': demoShipments,
  'demo.notifications': demoNotifications,
  'demo.feedback': demoFeedback,
};

async function createTopics() {
  const admin = kafka.admin();
  await admin.connect();
  console.log('✅ Admin connected');

  // Create topics
  for (const [topicName, config] of Object.entries(topics)) {
    console.log(`Creating topic: ${topicName} (partitions: ${config.numPartitions})`);
    await admin.createTopics({
      topics: [{
        topic: topicName,
        numPartitions: config.numPartitions,
        replicationFactor: config.replicationFactor,
      }],
    });
  }
  console.log('✅ All demo topics created');

  await admin.disconnect();
}

async function produceMessages() {
  const producer = kafka.producer();
  await producer.connect();
  console.log('✅ Producer connected');

  for (const [topic, messages] of Object.entries(topicMessages)) {
    console.log(`Producing ${messages.length} messages to ${topic}`);
    await producer.send({
      topic,
      messages: messages.map((msg, i) => ({
        key: `${topic.split('.')[1]}-${String(i + 1).padStart(3, '0')}`,
        value: JSON.stringify(msg),
      })),
    });
  }
  console.log('✅ All messages produced');

  await producer.disconnect();
}

async function main() {
  console.log('=== Creating demo topics ===');
  await createTopics();

  console.log('\n=== Producing demo messages ===');
  await produceMessages();

  console.log('\n=== Demo topics setup complete! ===');
}

main().catch(console.error);