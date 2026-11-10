const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const { PORT, BOT_VERSION } = require('./config/env.config');
const { startBot } = require('./services/whatsapp.service');
const { initCronJobs } = require('./jobs/cron.jobs');
const { initDatabase } = require('./config/db');
const { initHeartbeat } = require('./services/heartbeat.service');

const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log(`🔌 Client connected to Socket.IO (${socket.id})`);
  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected (${socket.id})`);
  });
});

// Start Server & Subsystems
server.listen(PORT, async () => {
  console.log(`🚀 WishMaster ${BOT_VERSION} running on port ${PORT}`);

  // Initialize Supabase Database
  try {
    await initDatabase();
  } catch (err) {
    console.error('⚠️ Database init error:', err.message);
  }

  // Initialize scheduled tasks with real-time Socket.IO sync
  initCronJobs(io);

  // Initialize Keep-Alive Heartbeat
  initHeartbeat();

  // Start WhatsApp Baileys Bot
  try {
    await startBot();
    console.log('🤖 WhatsApp Bot initialized');
  } catch (err) {
    console.error('❌ Failed to start WhatsApp Bot:', err.message || err);
  }
});

// Graceful shutdown handling
function shutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('⚠️ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
