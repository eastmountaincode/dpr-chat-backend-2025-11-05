# Desire Path Radio - Chat Backend

WebSocket server for real-time chat functionality using Socket.IO.

## Features

- Real-time bidirectional communication
- Two separate chat channels (channel1, channel2)
- In-memory message storage (50 messages per channel, FIFO)
- Unique user ID generation
- Message validation (500 character limit)
- CORS configured for security

## Requirements

- Node.js >= 18.0.0
- npm or yarn

## Installation

```bash
npm install
```

## Configuration

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Update `.env` with your configuration:
```env
PORT=3001
ALLOWED_ORIGINS=http://yourdomain.com,http://localhost:3000
```

## Running the Server

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

## Deployment to Digital Ocean (Ubuntu 24.04)

### 1. Connect to your server
```bash
ssh root@159.65.180.16
```

### 2. Install Node.js (if not already installed)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 3. Clone the repository
```bash
cd /opt
git clone <your-repo-url>
cd dpr_backend_chat_2025_11_05
```

### 4. Install dependencies
```bash
npm install --production
```

### 5. Configure environment
```bash
cp .env.example .env
nano .env
```

Update with your production values:
```env
PORT=3001
ALLOWED_ORIGINS=http://159.65.180.16,https://yourdomain.com
```

### 6. Setup PM2 for process management
```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the server
pm2 start server.js --name dpr-chat

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```

### 7. Configure firewall
```bash
# Allow port 3001
sudo ufw allow 3001/tcp
sudo ufw reload
```

## PM2 Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs dpr-chat

# Restart
pm2 restart dpr-chat

# Stop
pm2 stop dpr-chat

# Delete
pm2 delete dpr-chat
```

## Socket.IO Events

### Client → Server

**`send_message`**
```javascript
{
  channel: 'channel1' | 'channel2',
  username: string,
  message: string
}
```

### Server → Client

**`user_id`**
```javascript
string // UUID
```

**`message_history`**
```javascript
{
  channel1: Message[],
  channel2: Message[]
}
```

**`new_message`**
```javascript
{
  channel: 'channel1' | 'channel2',
  message: {
    id: string,
    userId: string,
    username: string,
    message: string
  }
}
```

**`error`**
```javascript
{
  message: string
}
```

## Message Structure

```typescript
interface Message {
  id: string;        // UUID
  userId: string;    // UUID of sender
  username: string;  // Screen name
  message: string;   // Message content (max 500 chars)
}
```

## Troubleshooting

### Port already in use
```bash
# Find process using port 3001
lsof -i :3001

# Kill the process
kill -9 <PID>
```

### CORS errors
- Ensure your frontend domain is listed in `ALLOWED_ORIGINS`
- Include protocol (http:// or https://)
- No trailing slashes

### Connection issues
- Check firewall rules: `sudo ufw status`
- Verify server is running: `pm2 status`
- Check logs: `pm2 logs dpr-chat`

## License

MIT
