require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const fs = require('fs');
const path = require('path');

// Catch all unhandled errors at startup
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

// Import routes
const authRoutes = require('./routes/auth.routes');
const guardRoutes = require('./routes/guard.routes');
const locationRoutes = require('./routes/location.routes');
const welfareRoutes = require('./routes/welfare.routes');
const sosRoutes = require('./routes/sos.routes');
const agencyRoutes = require('./routes/agency.routes');
const superadminRoutes = require('./routes/superadmin.routes');
const scripAdminRoutes = require('./routes/scripAdmin.routes');

const {
  incidentRouter, patrolRouter, messageRouter,
  billingRouter,  scheduleRouter, clientRouter,
  payrollRouter,  superRouter,    alertRouter,
  gateRouter,     webhookRouter,  auditRouter,
  pushRouter,
} = require('./routes/index.routes');

const { startWelfareCallScheduler } = require('./services/scheduler.service');
const { startReportScheduler } = require('./services/reports.service.js');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;

// ===== MIDDLEWARE =====
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));

// Billing webhook — mounted BEFORE express.json() so Stripe receives the raw body
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), billingRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ===== DATABASE CONNECTION =====
let mongoConnected = false;
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

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  console.log('🔌 New socket connection:', socket.id);

  // Join agency room
  socket.on('join-agency', (agencyId) => {
    socket.join(`agency-${agencyId}`);
    console.log(`Socket ${socket.id} joined agency-${agencyId}`);
  });

  // Join guard room (for receiving welfare calls)
  socket.on('join-guard', (guardId) => {
    socket.join(`guard-${guardId}`);
    console.log(`Socket ${socket.id} joined guard-${guardId}`);
  });

  // Join user-specific room (for direct messages to supervisors)
  socket.on('join-user', (userId) => {
    socket.join(`user-${userId}`);
    console.log(`Socket ${socket.id} joined user-${userId}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Socket disconnected:', socket.id);
  });
});

// Make io accessible in routes
app.set('io', io);

// Start background schedulers
startWelfareCallScheduler(io);
startReportScheduler();

// ===== UPLOADS DIRECTORY — create on startup =====
['uploads/incidents'].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    mongoConnected: mongoConnected
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/guard', guardRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/welfare', welfareRoutes);
app.use('/api/sos', sosRoutes);
app.use('/api/agency', agencyRoutes);
app.use('/api/scrip-admin', scripAdminRoutes);

// New feature routes
app.use('/api/incidents',        incidentRouter);
app.use('/api/patrol',           patrolRouter);
app.use('/api/messages',         messageRouter);
app.use('/api/billing',          billingRouter);
app.use('/api/schedule',         scheduleRouter);
app.use('/api/client',           clientRouter);
app.use('/api/payroll',          payrollRouter);
app.use('/api/superadmin',       superRouter);    // replaces the previous superadmin stub
app.use('/api/alerts',           alertRouter);
app.use('/api/gate',             gateRouter);
app.use('/api/webhooks',         webhookRouter);
app.use('/api/audit',            auditRouter);
app.use('/api/guard/push-token', pushRouter);

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

// Error handler
app.use(errorHandler);

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










// require('dotenv').config();
// const express = require('express');
// const mongoose = require('mongoose');
// const cors = require('cors');
// const http = require('http');
// const socketIO = require('socket.io');

// // Catch all unhandled errors at startup
// process.on('uncaughtException', (err) => {
//   console.error('❌ UNCAUGHT EXCEPTION:', err);
//   process.exit(1);
// });

// process.on('unhandledRejection', (reason, promise) => {
//   console.error('❌ UNHANDLED REJECTION at:', promise, 'reason:', reason);
// });

// // Import routes
// const authRoutes = require('./routes/auth.routes');
// const guardRoutes = require('./routes/guard.routes');
// const locationRoutes = require('./routes/location.routes');
// const welfareRoutes = require('./routes/welfare.routes');
// const sosRoutes = require('./routes/sos.routes');
// const agencyRoutes = require('./routes/agency.routes');
// const superadminRoutes = require('./routes/superadmin.routes');

// const scripAdminRoutes = require('./routes/scripAdmin.routes');
// const { startWelfareCallScheduler } = require('./services/scheduler.service');

// // Import middleware
// const { errorHandler } = require('./middleware/errorHandler');

// // Initialize Express app
// const app = express();
// const server = http.createServer(app);
// const io = socketIO(server, {
//   cors: {
//     origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
//     methods: ['GET', 'POST']
//   }
// });

// const PORT = process.env.PORT || 5000;

// // ===== MIDDLEWARE =====
// app.use(cors({
//   origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
//   credentials: true
// }));

// app.use(express.json());
// app.use(express.urlencoded({ extended: true }));

// // Request logging
// app.use((req, res, next) => {
//   console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
//   next();
// });

// // ===== DATABASE CONNECTION =====
// let mongoConnected = false;
// mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/grantsman', {
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
//   serverSelectionTimeoutMS: 5000,
//   connectTimeoutMS: 10000,
//   socketTimeoutMS: 45000,
//   retryWrites: true,
// })
// .then(() => {
//   mongoConnected = true;
//   console.log('✅ MongoDB connected successfully');
// })
// .catch((err) => {
//   mongoConnected = false;
//   console.warn('⚠️  MongoDB connection failed:', err.message);
//   console.warn('⚠️  Server will run in LIMITED MODE without database');
//   console.warn('⚠️  Make sure MongoDB is running: mongod');
// });

// // ===== SOCKET.IO =====
// io.on('connection', (socket) => {
//   console.log('🔌 New socket connection:', socket.id);

//   // Join agency room
//   socket.on('join-agency', (agencyId) => {
//     socket.join(`agency-${agencyId}`);
//     console.log(`Socket ${socket.id} joined agency-${agencyId}`);
//   });

//   // Join guard room (for receiving welfare calls)
//   socket.on('join-guard', (guardId) => {
//     socket.join(`guard-${guardId}`);
//     console.log(`Socket ${socket.id} joined guard-${guardId}`);
//   });

//   socket.on('disconnect', () => {
//     console.log('🔌 Socket disconnected:', socket.id);
//   });
// });

// // Make io accessible in routes
// app.set('io', io);

// // Start background scheduler for random welfare checks
// startWelfareCallScheduler(io);

// // ===== ROUTES =====
// app.get('/', (req, res) => {
//   res.json({
//     message: '🛡️ Grantsman API',
//     version: '1.0.0',
//     status: 'running',
//     endpoints: {
//       auth: '/api/auth',
//       guard: '/api/guard',
//       location: '/api/location',
//       welfare: '/api/welfare',
//       sos: '/api/sos'
//     }
//   });
// });

// // Health check
// app.get('/health', (req, res) => {
//   res.json({ 
//     status: 'healthy', 
//     timestamp: new Date().toISOString(),
//     database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
//     mongoConnected: mongoConnected
//   });
// });


// // API Routes
// app.use('/api/auth', authRoutes);
// app.use('/api/guard', guardRoutes);
// app.use('/api/location', locationRoutes);
// app.use('/api/welfare', welfareRoutes);
// app.use('/api/sos', sosRoutes);
// app.use('/api/agency', agencyRoutes);
// app.use('/api/superadmin', superadminRoutes);
// app.use('/api/scrip-admin', scripAdminRoutes);

// // 404 handler
// app.use((req, res) => {
//   res.status(404).json({
//     success: false,
//     error: {
//       code: 'NOT_FOUND',
//       message: `Route ${req.method} ${req.path} not found`
//     }
//   });
// });

// // Error handler
// app.use(errorHandler);

// // ===== START SERVER =====
// server.listen(PORT, '0.0.0.0', () => {
//   console.log(`
// ╔════════════════════════════════════════╗
// ║     🛡️  Grantsman Backend API     ║
// ╠════════════════════════════════════════╣
// ║  Port:     ${PORT.toString().padEnd(28)} ║
// ║  Env:      ${(process.env.NODE_ENV || 'development').padEnd(28)} ║
// ║  MongoDB:  ${(mongoConnected ? 'Connected ✓' : 'Disconnected ✗').padEnd(28)} ║
// ╚════════════════════════════════════════╝
//   `);
//   console.log(`📡 Server running at http://0.0.0.0:${PORT}`);
//   console.log(`🔌 Socket.IO ready for real-time connections`);
//   console.log(`📱 Mobile app can connect at http://YOUR_IP:${PORT}`);
  
//   if (!mongoConnected) {
//     console.log(`\n⚠️  MongoDB is NOT connected!`);
//     console.log(`   To start MongoDB, run: mongod`);
//     console.log(`   Or set MONGODB_URI in .env to your remote MongoDB\n`);
//   }
// });

// // Graceful shutdown
// process.on('SIGTERM', () => {
//   console.log('SIGTERM received. Shutting down gracefully...');
//   server.close(() => {
//     console.log('Server closed');
//     mongoose.connection.close(false, () => {
//       console.log('MongoDB connection closed');
//       process.exit(0);
//     });
//   });
// });

// module.exports = { app, io };