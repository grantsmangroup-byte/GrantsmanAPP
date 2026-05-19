const mongoose = require('mongoose');

const guardSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  name: { type: String, required: true },
  phone: { type: String, required: true },
  device: { type: String, enum: ['smartphone', 'button-phone'], default: 'smartphone' },
  assignedSiteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  shiftStart: { type: String, required: true }, // "18:00"
  shiftEnd: { type: String, required: true }, // "06:00"
  status: { type: String, enum: ['on-duty', 'off-duty'], default: 'off-duty' },
  alertnessScore: { type: Number, default: 100, min: 0, max: 100 },
  isActive: { type: Boolean, default: true },
  currentShiftId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
  lastLocationUpdate: {
    latitude: Number,
    longitude: Number,
    timestamp: Date,
    accuracy: Number
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Guard', guardSchema);