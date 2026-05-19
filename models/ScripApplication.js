const mongoose = require('mongoose');

// ── Sub-schemas ──────────────────────────────────────────────────────────────

const jobSchema = new mongoose.Schema({
  company: { type: String, trim: true },
  role:    { type: String, trim: true },
  years:   { type: String, trim: true },
}, { _id: false });

const certificationSchema = new mongoose.Schema({
  name:        { type: String, trim: true },
  institution: { type: String, trim: true },
  year:        { type: String, trim: true },
}, { _id: false });

// ── Main Schema ──────────────────────────────────────────────────────────────

const scripApplicationSchema = new mongoose.Schema({

  // ── Step 1: Identification ─────────────────────────────────────────────────
  identity: {
    firstName:   { type: String, required: true, trim: true },
    lastName:    { type: String, required: true, trim: true },
    dob:         { type: String, required: true },           // ISO date string
    gender:      { type: String, required: true },
    nationality: { type: String, required: true, trim: true },
    idNumber:    { type: String, required: true, trim: true },
    email:       {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    phone:       { type: String, required: true, trim: true },
    photoFileName: { type: String, trim: true },             // stored filename / cloud URL
    programArea: {
      type: String,
      required: true,
      enum: ['Finance', 'Security', 'IT', 'Health', 'Logistics'],
    },
  },

  // ── Step 2: Legal & Residency ──────────────────────────────────────────────
  legal: {
    criminalRecord:  { type: String, required: true, enum: ['Yes', 'No'] },
    criminalDetails: { type: String, trim: true },           // only if Yes
    country:  { type: String, required: true, trim: true },
    region:   { type: String, required: true, trim: true },
    city:     { type: String, required: true, trim: true },
    quarter:  { type: String, trim: true },
    address:  { type: String, required: true, trim: true },
    isIdp:    { type: String, required: true, enum: ['Yes', 'No'] },
    idpSince: { type: String, trim: true },                  // only if Yes; format YYYY-MM
  },

  // ── Step 3: Employment & Program Status ────────────────────────────────────
  employment: {
    jobs:       { type: [jobSchema], default: [] },
    enrolled:   {
      type: String,
      enum: ['Yes', 'No', 'Graduating soon', ''],
      default: '',
    },
    startDate:  { type: String, trim: true },                // ISO date, min +3 weeks
  },

  // ── Step 4: Education ──────────────────────────────────────────────────────
  education: {
    edu1Cert:        { type: String, trim: true },
    edu1Institution: { type: String, trim: true },
    edu1Year:        { type: String, trim: true },
    edu1Level:       { type: String, trim: true },
    edu2Cert:        { type: String, trim: true },
    edu2Institution: { type: String, trim: true },
    edu2Year:        { type: String, trim: true },
    edu2Level:       { type: String, trim: true },
    certifications:  { type: [certificationSchema], default: [] },
  },

  // ── Application Metadata ───────────────────────────────────────────────────
  referenceCode: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
  },

  status: {
    type: String,
    enum: [
      'submitted',        // Step 1 — awaiting review
      'under_review',     // Due diligence in progress
      'confirmed',        // Step 2 — code & badge issued
      'enrolled',         // Step 3 — enrolled in programme
      'completed',        // Step 4 — workshop done
      'recommended',      // Step 5 — professional recommendation issued
      'rejected',         // Disqualified at any stage
    ],
    default: 'submitted',
  },

  // Reviewer notes (admin only)
  reviewNotes: { type: String, trim: true },

  submittedAt: { type: Date, default: Date.now },
  updatedAt:   { type: Date, default: Date.now },
});

// ── Indexes ──────────────────────────────────────────────────────────────────
scripApplicationSchema.index({ 'identity.email': 1 });
scripApplicationSchema.index({ 'identity.phone': 1 });
scripApplicationSchema.index({ referenceCode: 1 }, { unique: true });
scripApplicationSchema.index({ status: 1 });
scripApplicationSchema.index({ submittedAt: -1 });

// ── Auto-update updatedAt ─────────────────────────────────────────────────────
scripApplicationSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

// ── Virtual: full name ────────────────────────────────────────────────────────
scripApplicationSchema.virtual('fullName').get(function () {
  return `${this.identity.firstName} ${this.identity.lastName}`;
});

scripApplicationSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('ScripApplication', scripApplicationSchema);
