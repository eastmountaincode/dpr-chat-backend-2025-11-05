require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');

const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const MAX_MESSAGES_PER_CHANNEL = 25;
const MAX_MESSAGE_LENGTH = 500;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_IMAGE_WIDTH = 1200;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// File paths for message persistence
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const BACKUP_FILE = path.join(DATA_DIR, 'messages-backup.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// In-memory message storage
let messages = {
  channel1: [],
  channel2: []
};

// Load messages from file on startup
function loadMessages() {
  try {
    let loadedMessages = null;
    let source = null;

    // Try to load from messages.json first
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
      loadedMessages = JSON.parse(data);
      source = 'messages.json';
    }
    // Fall back to messages-backup.json if messages.json doesn't exist
    else if (fs.existsSync(BACKUP_FILE)) {
      const data = fs.readFileSync(BACKUP_FILE, 'utf8');
      loadedMessages = JSON.parse(data);
      source = 'messages-backup.json';
      console.log('📋 Migrating messages from backup file...');
    }

    if (loadedMessages) {
      // Load messages as-is (don't fabricate timestamps for old messages)
      messages = loadedMessages;

      const totalMessages = messages.channel1.length + messages.channel2.length;
      const messagesWithTimestamps = [...messages.channel1, ...messages.channel2].filter(m => m.timestamp).length;

      console.log(`✅ Loaded ${totalMessages} messages from ${source}`);
      console.log(`   ${messagesWithTimestamps} with timestamps, ${totalMessages - messagesWithTimestamps} without`);

      // Save to messages.json if we loaded from backup
      if (source === 'messages-backup.json') {
        saveMessages();
        console.log('✅ Migrated to messages.json');
      }
    }
  } catch (error) {
    console.error('⚠️  Error loading messages:', error.message);
    console.log('Starting with empty message history');
  }
}

// Save messages to file
function saveMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error('⚠️  Error saving messages:', error.message);
  }
}

// Delete image file associated with a message
function deleteMessageImage(message) {
  if (message.imageUrl) {
    const filename = path.basename(message.imageUrl);
    const filepath = path.join(UPLOADS_DIR, filename);
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`🗑️  Deleted image: ${filename}`);
      }
    } catch (error) {
      console.error(`⚠️  Error deleting image ${filename}:`, error.message);
    }
  }
}

// Load messages on startup
loadMessages();

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// CORS middleware for Express
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve uploaded images as static files
app.use('/uploads', express.static(UPLOADS_DIR));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: jpg, png, gif, webp'));
    }
  }
});

// Upload endpoint
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const filename = `${uuidv4()}${ext}`;
    const filepath = path.join(UPLOADS_DIR, filename);

    // Check if it's a GIF (don't resize GIFs to preserve animation)
    const isGif = req.file.mimetype === 'image/gif';

    if (isGif) {
      // Save GIF as-is
      fs.writeFileSync(filepath, req.file.buffer);
    } else {
      // Resize non-GIF images if wider than MAX_IMAGE_WIDTH
      const image = sharp(req.file.buffer);
      const metadata = await image.metadata();

      if (metadata.width > MAX_IMAGE_WIDTH) {
        await image
          .resize(MAX_IMAGE_WIDTH, null, { withoutEnlargement: true })
          .toFile(filepath);
      } else {
        fs.writeFileSync(filepath, req.file.buffer);
      }
    }

    const imageUrl = `/uploads/${filename}`;
    console.log(`📸 Uploaded image: ${filename} (${(req.file.size / 1024).toFixed(1)} KB)`);

    res.json({ imageUrl });
  } catch (error) {
    console.error('⚠️  Upload error:', error.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Handle multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5 MB.' });
    }
  }
  if (error.message) {
    return res.status(400).json({ error: error.message });
  }
  next(error);
});

// Initialize Socket.IO server with Express
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Start the server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Allowed origins:`, ALLOWED_ORIGINS);
});

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
    const { channel, username, message, imageUrl } = data;

    // Validation
    if (!channel || !['channel1', 'channel2'].includes(channel)) {
      socket.emit('error', { message: 'Invalid channel' });
      return;
    }

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      socket.emit('error', { message: 'Username is required' });
      return;
    }

    // Allow empty message if there's an image
    const hasMessage = message && typeof message === 'string' && message.trim().length > 0;
    const hasImage = imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('/uploads/');

    if (!hasMessage && !hasImage) {
      socket.emit('error', { message: 'Message or image is required' });
      return;
    }

    if (hasMessage && message.length > MAX_MESSAGE_LENGTH) {
      socket.emit('error', { message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      return;
    }

    // Create message object
    const newMessage = {
      id: uuidv4(),
      userId,
      username: username.trim(),
      message: hasMessage ? message.trim() : '',
      timestamp: new Date().toISOString()
    };

    // Add imageUrl if present
    if (hasImage) {
      newMessage.imageUrl = imageUrl;
    }

    // Add to in-memory storage
    messages[channel].push(newMessage);

    // Maintain max messages (FIFO) - delete associated images
    if (messages[channel].length > MAX_MESSAGES_PER_CHANNEL) {
      const removedMessage = messages[channel].shift();
      deleteMessageImage(removedMessage);
    }

    // Save to persistent storage
    saveMessages();

    // Broadcast to all connected clients
    io.emit('new_message', {
      channel,
      message: newMessage
    });

    const logMsg = hasMessage ? message.substring(0, 50) + (message.length > 50 ? '...' : '') : '[image]';
    console.log(`📨 [${channel}] ${username}: ${logMsg}`);
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

    // Clear messages and delete associated images
    if (channel === 'both' || !channel) {
      messages.channel1.forEach(deleteMessageImage);
      messages.channel2.forEach(deleteMessageImage);
      messages.channel1 = [];
      messages.channel2 = [];
      console.log(`🧹 Admin cleared ALL chat channels`);
    } else {
      messages[channel].forEach(deleteMessageImage);
      messages[channel] = [];
      console.log(`🧹 Admin cleared ${channel}`);
    }

    // Save cleared state to persistent storage
    saveMessages();

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
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
