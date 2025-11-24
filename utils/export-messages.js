const io = require('socket.io-client');
const fs = require('fs');

const PRODUCTION_SERVER = 'http://159.65.180.16:3001';

const socket = io(PRODUCTION_SERVER);

socket.on('connect', () => {
  console.log('Connected to production server...');
});

socket.on('message_history', (messages) => {
  console.log(`Received ${Object.keys(messages).length} channels of messages`);

  // Count total messages
  const totalMessages = Object.values(messages).reduce((sum, channel) => sum + channel.length, 0);
  console.log(`Total messages: ${totalMessages}`);

  // Save to JSON file
  fs.writeFileSync(
    'messages-backup.json',
    JSON.stringify(messages, null, 2)
  );

  console.log('✅ Messages saved to messages-backup.json');
  process.exit(0);
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  process.exit(1);
});
