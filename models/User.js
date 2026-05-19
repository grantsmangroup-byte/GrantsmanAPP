const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  fullName:  { type: String, required: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true },
  phone:     { type: String, required: true, unique: true },
  password:  { type: String, required: true },

  role: {
    type: String,
    enum: ['super-admin', 'agency-admin', 'supervisor', 'guard', 'client'],
    required: true,
  },

  agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency' },

  // ── Supervisor: which sites they manage ───────────────────────────────────
  supervisedSiteIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Site' }],

  // ── Client: which sites they can view (read-only portal) ─────────────────
  assignedSiteIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Site' }],
  companyName:     { type: String, trim: true },

  // ── Push token (stored here for supervisors; guards store on Guard model) ─
  pushToken: String,

  isActive:  { type: Boolean, default: true },
  createdAt: { type: Date,    default: Date.now },
  lastLogin: Date,
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.index({ agencyId: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);










// const mongoose = require('mongoose');
// const bcrypt = require('bcryptjs');

// const userSchema = new mongoose.Schema({
//   fullName: { type: String, required: true },
//   email: { type: String, required: true, unique: true, lowercase: true },
//   phone: { type: String, required: true, unique: true },
//   password: { type: String, required: true },
//   role: { 
//     type: String, 
//     enum: ['super-admin', 'agency-admin', 'guard'], 
//     required: true 
//   },
//   agencyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency' },
//   isActive: { type: Boolean, default: true },
//   createdAt: { type: Date, default: Date.now }
// });

// // Hash password before saving
// userSchema.pre('save', async function(next) {
//   if (!this.isModified('password')) return next();
//   this.password = await bcrypt.hash(this.password, 10);
//   next();
// });

// // Compare password method
// userSchema.methods.comparePassword = async function(candidatePassword) {
//   return await bcrypt.compare(candidatePassword, this.password);
// };

// module.exports = mongoose.model('User', userSchema);