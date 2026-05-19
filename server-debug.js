#!/usr/bin/env node
console.log('🔍 Starting server with debug logging...\n');

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');

console.log('✅ Modules imported');

// Import routes
try {
  const authRoutes = require('./routes/auth.routes');
  const guardRoutes = require('./routes/guard.routes');
  const locationRoutes = require('./routes/location.routes');
  const welfareRoutes = require('./routes/welfare.routes');
  const sosRoutes = require('./routes/sos.routes');
  console.log('✅ Routes imported');

  // Import middleware
  const { errorHandler } = require('./middleware/errorHandler');
  console.log('✅ Middleware imported');

  // Initialize Express app
  const app = express();
  console.log('✅ Express app created');

  const server = http.createServer(app);
  console.log('✅ HTTP server created');

  const io = socketIO(server, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      methods: ['GET', 'POST']
    }
  });
  console.log('✅ Socket.IO initialized');

  const PORT = process.env.PORT || 5000;

  // ===== MIDDLEWARE =====
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
  }));
  console.log('✅ CORS middleware added');

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  console.log('✅ Body parser middleware added');

  // Request logging
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });
  console.log('✅ Request logging middleware added');

  // ===== DATABASE CONNECTION =====
  let mongoConnected = false;
  console.log('\n⏳ Attempting MongoDB connection to:', process.env.MONGODB_URI || 'mongodb://localhost:27017/grantsman');
  
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/grantsman', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true,
  })
  .then(() => {
    mongoConnected = true;
    console.log('✅ MongoDB connected successfully');
  })
  .catch((err) => {
    mongoConnected = false;
    console.warn('⚠️  MongoDB connection failed:', err.message);
    console.warn('⚠️  Server will run in LIMITED MODE without database');
    console.warn('⚠️  Make sure MongoDB is running: mongod');
  });

  console.log('✅ MongoDB connection handler set up');

  // ===== SOCKET.IO =====
  io.on('connection', (socket) => {
    console.log('🔌 New socket connection:', socket.id);

    socket.on('join-agency', (agencyId) => {
      socket.join(`agency-${agencyId}`);
      console.log(`Socket ${socket.id} joined agency-${agencyId}`);
    });

    socket.on('join-guard', (guardId) => {
      socket.join(`guard-${guardId}`);
      console.log(`Socket ${socket.id} joined guard-${guardId}`);
    });

    socket.on('disconnect', () => {
      console.log('🔌 Socket disconnected:', socket.id);
    });
  });
  console.log('✅ Socket.IO handlers set up');

  // Make io accessible in routes
  app.set('io', io);

  // ===== ROUTES =====
  app.get('/', (req, res) => {
    res.json({
      message: '🛡️ Grantsman API',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        auth: '/api/auth',
        guard: '/api/guard',
        location: '/api/location',
        welfare: '/api/welfare',
        sos: '/api/sos'
      }
    });
  });
  console.log('✅ Root route added');

  // Health check
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      mongoConnected: mongoConnected
    });
  });
  console.log('✅ Health check route added');

  // API Routes
  console.log('Adding auth routes...');
  app.use('/api/auth', authRoutes);
  console.log('✅ Auth routes added');
  
  console.log('Adding guard routes...');
  app.use('/api/guard', guardRoutes);
  console.log('✅ Guard routes added');
  
  console.log('Adding location routes...');
  app.use('/api/location', locationRoutes);
  console.log('✅ Location routes added');
  
  console.log('Adding welfare routes...');
  app.use('/api/welfare', welfareRoutes);
  console.log('✅ Welfare routes added');
  
  console.log('Adding SOS routes...');
  app.use('/api/sos', sosRoutes);
  console.log('✅ SOS routes added');

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.path} not found`
      }
    });
  });
  console.log('✅ 404 handler added');

  // Error handler
  app.use(errorHandler);
  console.log('✅ Error handler added');

  // ===== START SERVER =====
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔════════════════════════════════════════╗
║     🛡️  Grantsman Backend API     ║
╠════════════════════════════════════════╣
║  Port:     ${PORT.toString().padEnd(28)} ║
║  Env:      ${(process.env.NODE_ENV || 'development').padEnd(28)} ║
║  MongoDB:  ${(mongoConnected ? 'Connected ✓' : 'Disconnected ✗').padEnd(28)} ║
╚════════════════════════════════════════╝
    `);
    console.log(`📡 Server running at http://0.0.0.0:${PORT}`);
    console.log(`🔌 Socket.IO ready for real-time connections`);
    console.log(`📱 Mobile app can connect at http://YOUR_IP:${PORT}`);
    
    if (!mongoConnected) {
      console.log(`\n⚠️  MongoDB is NOT connected!`);
      console.log(`   To start MongoDB, run: mongod`);
      console.log(`   Or set MONGODB_URI in .env to your remote MongoDB\n`);
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed');
      mongoose.connection.close(false, () => {
        console.log('MongoDB connection closed');
        process.exit(0);
      });
    });
  });

  module.exports = { app, io };

} catch(err) {
  console.error('❌ ERROR DURING INITIALIZATION:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
}
