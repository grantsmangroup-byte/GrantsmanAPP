const mongoose = require('mongoose');

const agencySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  adminName: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true },
  address: String,
  status: { type: String, enum: ['active', 'suspended'], default: 'active' },
  mrr: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Agency', agencySchema);