const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  agencyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },

  // A thread is a conversation between two users (guard + supervisor)
  threadId:   { type: String, required: true }, // composite: sorted([userId1, userId2]).join('_')

  senderId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipientId:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  body:       { type: String, required: true, maxlength: 1000, trim: true },
  readAt:     Date,

  // Linked context (optional — attach to a welfare check or incident)
  refType:    { type: String, enum: ['incident', 'welfare', 'sos', null] },
  refId:      { type: mongoose.Schema.Types.ObjectId },

  createdAt:  { type: Date, default: Date.now },
});

messageSchema.index({ threadId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, readAt: 1 }); // unread count queries

// Generate deterministic thread ID from two user IDs
messageSchema.statics.threadIdFor = (idA, idB) =>
  [String(idA), String(idB)].sort().join('_');

module.exports = mongoose.model('Message', messageSchema);

