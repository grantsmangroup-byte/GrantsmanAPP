const mongoose = require('mongoose');

const locationPingSchema = new mongoose.Schema({
  guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', required: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  accuracy: Number,
  timestamp: { type: Date, default: Date.now },
  source: { type: String, enum: ['gps', 'lbs', 'manual'], default: 'gps' },
  withinGeofence: Boolean
});

module.exports = mongoose.model('LocationPing', locationPingSchema);