const mongoose = require('mongoose');

const siteSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  latitude: { type: Number, required: true },
  longitude: { type: Number, required: true },
  geofenceRadius: { type: Number, default: 50 }, // meters
  assignedGuards: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Guard' }],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Site', siteSchema);