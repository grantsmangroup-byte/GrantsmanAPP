const mongoose = require('mongoose');

const sosAlertSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', required: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  triggeredAt: { type: Date, default: Date.now },
  location: {
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true }
  },
  status: { type: String, enum: ['active', 'resolved', 'cancelled'], default: 'active' },
  resolvedAt: Date,
  notes: String,
  notificationsSent: [String] // ['email', 'sms', 'dashboard']
});

module.exports = mongoose.model('SOSAlert', sosAlertSchema);