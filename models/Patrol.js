const mongoose = require('mongoose');

// ── Checkpoint: a fixed physical point a guard must visit ─────────────────────
const checkpointSchema = new mongoose.Schema({
  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  siteId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Site',   required: true },
  name:     { type: String, required: true, trim: true },
  qrCode:   { type: String, required: true, unique: true }, // UUID stored on physical QR label
  nfcTag:   { type: String, unique: true, sparse: true },
  location: { latitude: Number, longitude: Number },
  order:    { type: Number, default: 0 },    // position in route
  isActive: { type: Boolean, default: true },
  createdAt:{ type: Date, default: Date.now },
});

// ── PatrolScan: log entry when a guard scans a checkpoint ─────────────────────
const patrolScanSchema = new mongoose.Schema({
  agencyId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  guardId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Guard',  required: true },
  siteId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Site',   required: true },
  checkpointId: { type: mongoose.Schema.Types.ObjectId, ref: 'Checkpoint', required: true },
  shiftId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
  scannedAt:    { type: Date, default: Date.now },
  method:       { type: String, enum: ['qr', 'nfc', 'manual'], default: 'qr' },
  location:     { latitude: Number, longitude: Number },
  // Offline: accepted even if scannedAt is in the past
  clientRefId:  { type: String, unique: true, sparse: true },
});

patrolScanSchema.index({ guardId: 1, scannedAt: -1 });
patrolScanSchema.index({ siteId: 1, scannedAt: -1 });

const Checkpoint = mongoose.model('Checkpoint', checkpointSchema);
const PatrolScan  = mongoose.model('PatrolScan', patrolScanSchema);

module.exports = { Checkpoint, PatrolScan };