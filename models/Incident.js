const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema({
  // ── Ownership ──────────────────────────────────────────────────────────────
  agencyId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Agency',  required: true },
  guardId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Guard',   required: true },
  siteId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Site',    required: true },
  shiftId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Shift' },
  reportedBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },

  // ── Classification ─────────────────────────────────────────────────────────
  category: {
    type: String,
    required: true,
    enum: [
      'theft',
      'vandalism',
      'trespassing',
      'suspicious_activity',
      'altercation',
      'medical',
      'fire',
      'property_damage',
      'access_violation',
      'equipment_failure',
      'other',
    ],
  },
  severity: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
  },

  // ── Content ────────────────────────────────────────────────────────────────
  title:       { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },

  // ── Location at time of incident ───────────────────────────────────────────
  location: {
    latitude:  Number,
    longitude: Number,
    address:   String,
  },

  // ── Media attachments (stored paths / cloud URLs) ──────────────────────────
  attachments: [
    {
      url:      { type: String, required: true },
      mimeType: { type: String, default: 'image/jpeg' },
      caption:  String,
    },
  ],

  // ── Timestamps ─────────────────────────────────────────────────────────────
  occurredAt:  { type: Date, required: true, default: Date.now },
  reportedAt:  { type: Date, default: Date.now },

  // ── Resolution workflow ────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['open', 'under_review', 'resolved', 'closed'],
    default: 'open',
  },
  resolution: {
    notes:      String,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
  },

  // ── Supervisor / client visibility flags ───────────────────────────────────
  clientVisible: { type: Boolean, default: false },

  // ── Offline support: client-generated ID for idempotency ──────────────────
  clientRefId: { type: String, unique: true, sparse: true },
});

// Indexes for common query patterns
incidentSchema.index({ agencyId: 1, siteId: 1, reportedAt: -1 });
incidentSchema.index({ guardId: 1, reportedAt: -1 });
incidentSchema.index({ status: 1, severity: 1 });
incidentSchema.index({ clientRefId: 1 }, { sparse: true });

module.exports = mongoose.model('Incident', incidentSchema);