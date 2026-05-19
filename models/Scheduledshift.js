const mongoose = require('mongoose');

// ── ScheduledShift: a planned assignment for one guard on one date ─────────────
const scheduledShiftSchema = new mongoose.Schema({
  agencyId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Agency',  required: true },
  guardId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Guard',   required: true },
  siteId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Site',    required: true },
  date:      { type: String, required: true },   // ISO date string "YYYY-MM-DD"
  startTime: { type: String, required: true },   // "HH:MM"
  endTime:   { type: String, required: true },
  type:      { type: String, enum: ['regular', 'overtime', 'cover'], default: 'regular' },
  status:    { type: String, enum: ['scheduled', 'completed', 'missed', 'swapped', 'cancelled'], default: 'scheduled' },
  notes:     String,

  // Swap tracking
  originalGuardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Guard' },
  swapRequestedAt: Date,
  swapApprovedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },
});

scheduledShiftSchema.index({ agencyId: 1, date: 1 });
scheduledShiftSchema.index({ guardId: 1, date: 1 });
scheduledShiftSchema.index({ siteId: 1, date: 1 });

// Prevent double-booking: one guard, one date, one start time
scheduledShiftSchema.index({ guardId: 1, date: 1, startTime: 1 }, { unique: true });

module.exports = mongoose.model('ScheduledShift', scheduledShiftSchema);