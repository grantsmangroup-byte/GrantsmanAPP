const mongoose = require('mongoose');

const welfareCallSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', required: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
  scheduledAt: { type: Date, required: true },
  answeredAt: Date,
  status: { type: String, enum: ['scheduled', 'answered', 'missed'], default: 'scheduled' },
  location: {
    latitude: Number,
    longitude: Number,
    accuracy: Number
  },
  withinGeofence: Boolean,
  callDuration: Number, // seconds
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WelfareCall', welfareCallSchema);