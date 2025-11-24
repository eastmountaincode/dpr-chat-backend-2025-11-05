require('dotenv').config();
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const MAX_MESSAGES_PER_CHANNEL = 50;
const MAX_MESSAGE_LENGTH = 500;

// In-memory message storage
const messages = {
  channel1: [],
  channel2: []
};

// Initialize Socket.IO server
const io = new Server(PORT, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

console.log(`🚀 Socket.IO server running on port ${PORT}`);
console.log(`📡 Allowed origins:`, ALLOWED_ORIGINS);

// Handle client connections
io.on('connection', (socket) => {
  const userId = uuidv4();
  console.log(`✅ Client connected: ${socket.id} | User ID: ${userId}`);

  // Send unique user ID to client
  socket.emit('user_id', userId);

  // Send message history for both channels
  socket.emit('message_history', {
    channel1: messages.channel1,
    channel2: messages.channel2
  });

  // Handle incoming messages
  socket.on('send_message', (data) => {
    const { channel, username, message } = data;

    // Validation
    if (!channel || !['channel1', 'channel2'].includes(channel)) {
      socket.emit('error', { message: 'Invalid channel' });
      return;
    }

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      socket.emit('error', { message: 'Username is required' });
      return;
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      socket.emit('error', { message: 'Message cannot be empty' });
      return;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      socket.emit('error', { message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      return;
    }

    // Create message object
    const newMessage = {
      id: uuidv4(),
      userId,
      username: username.trim(),
      message: message.trim(),
      timestamp: new Date().toISOString()
    };

    // Add to in-memory storage
    messages[channel].push(newMessage);

    // Maintain max 50 messages (FIFO)
    if (messages[channel].length > MAX_MESSAGES_PER_CHANNEL) {
      messages[channel].shift(); // Remove oldest message
    }

    // Broadcast to all connected clients
    io.emit('new_message', {
      channel,
      message: newMessage
    });

    console.log(`📨 [${channel}] ${username}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`);
  });

  // Admin: Clear chat messages
  socket.on('clear_chat', (data) => {
    const { channel, secret } = data;

    // Validate admin secret
    if (secret !== ADMIN_SECRET) {
      socket.emit('error', { message: 'Unauthorized: Invalid admin secret' });
      console.log(`⚠️  Unauthorized clear_chat attempt from ${socket.id}`);
      return;
    }

    // Validate channel
    if (channel && !['channel1', 'channel2', 'both'].includes(channel)) {
      socket.emit('error', { message: 'Invalid channel' });
      return;
    }

    // Clear messages
    if (channel === 'both' || !channel) {
      messages.channel1 = [];
      messages.channel2 = [];
      console.log(`🧹 Admin cleared ALL chat channels`);
    } else {
      messages[channel] = [];
      console.log(`🧹 Admin cleared ${channel}`);
    }

    // Broadcast cleared state to all clients
    io.emit('chat_cleared', { channel: channel || 'both' });

    // Send updated empty message history
    io.emit('message_history', {
      channel1: messages.channel1,
      channel2: messages.channel2
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`⚠️  Socket error [${socket.id}]:`, error);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  io.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  io.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
