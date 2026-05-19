const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema({
  guardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard', required: true },
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
  clockInTime: { type: Date, required: true },
  clockInLocation: {
    latitude: Number,
    longitude: Number
  },
  clockOutTime: Date,
  clockOutLocation: {
    latitude: Number,
    longitude: Number
  },
  status: { type: String, enum: ['active', 'completed'], default: 'active' }
});

module.exports = mongoose.model('Shift', shiftSchema);