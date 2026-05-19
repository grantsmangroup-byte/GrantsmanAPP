#!/usr/bin/env node
console.log('🔍 Starting Grantsman Backend Test...');

// Test 1: Check dotenv
console.log('1️⃣  Testing dotenv...');
try {
  require('dotenv').config();
  console.log('   ✅ dotenv loaded');
} catch(e) {
  console.error('   ❌ dotenv error:', e.message);
  process.exit(1);
}

// Test 2: Check required modules
console.log('2️⃣  Testing modules...');
try {
  const express = require('express');
  const mongoose = require('mongoose');
  const cors = require('cors');
  const http = require('http');
  const socketIO = require('socket.io');
  console.log('   ✅ All modules loaded');
} catch(e) {
  console.error('   ❌ Module loading error:', e.message);
  process.exit(1);
}

// Test 3: Check routes exist
console.log('3️⃣  Testing routes...');
try {
  const authRoutes = require('./routes/auth.routes');
  const guardRoutes = require('./routes/guard.routes');
  const locationRoutes = require('./routes/location.routes');
  const welfareRoutes = require('./routes/welfare.routes');
  const sosRoutes = require('./routes/sos.routes');
  console.log('   ✅ All routes loaded');
} catch(e) {
  console.error('   ❌ Routes loading error:', e.message);
  console.error('   Stack:', e.stack);
  process.exit(1);
}

// Test 4: Check middleware exists
console.log('4️⃣  Testing middleware...');
try {
  const { errorHandler } = require('./middleware/errorHandler');
  console.log('   ✅ Error handler loaded');
} catch(e) {
  console.error('   ❌ Middleware loading error:', e.message);
  process.exit(1);
}

// Test 5: Test environment variables
console.log('5️⃣  Testing environment...');
console.log('   PORT:', process.env.PORT || '5000');
console.log('   NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('   MONGODB_URI:', process.env.MONGODB_URI ? '✅ Set' : '⚠️  Using default (localhost)');
console.log('   JWT_SECRET:', process.env.JWT_SECRET ? '✅ Set' : '⚠️  Using default');

console.log('\n✅ All tests passed! Server can be started.');
