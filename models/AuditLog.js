const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  agencyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Agency' },
  actorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorRole:  String,
  action:     { type: String, required: true }, // e.g. 'guard.created', 'sos.resolved'
  entityType: String,   // 'Guard', 'Incident', 'SOSAlert', etc.
  entityId:   mongoose.Schema.Types.ObjectId,
  before:     mongoose.Schema.Types.Mixed, // snapshot before change
  after:      mongoose.Schema.Types.Mixed, // snapshot after change
  ip:         String,
  userAgent:  String,
  timestamp:  { type: Date, default: Date.now },
});

auditLogSchema.index({ agencyId: 1, timestamp: -1 });
auditLogSchema.index({ actorId: 1, timestamp: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);