const mongoose = require('mongoose');

// ── Plan catalogue (define in DB or seed) ─────────────────────────────────────
const planSchema = new mongoose.Schema({
  name:             { type: String, required: true },          // 'Starter', 'Growth', 'Enterprise'
  monthlyPriceCents:{ type: Number, required: true },
  maxGuards:        { type: Number, required: true },
  maxSites:         { type: Number, required: true },
  features:         [String],
  stripePriceId:    String,                                    // Stripe Price object ID
  isActive:         { type: Boolean, default: true },
});

// ── Subscription: one per agency ──────────────────────────────────────────────
const subscriptionSchema = new mongoose.Schema({
  agencyId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true, unique: true },
  planId:             { type: mongoose.Schema.Types.ObjectId, ref: 'Plan',   required: true },
  status:             { type: String, enum: ['trialing', 'active', 'past_due', 'cancelled', 'paused'], default: 'trialing' },
  stripeCustomerId:   String,
  stripeSubscriptionId: String,
  trialEndsAt:        Date,
  currentPeriodStart: Date,
  currentPeriodEnd:   Date,
  cancelAtPeriodEnd:  { type: Boolean, default: false },
  createdAt:          { type: Date, default: Date.now },
  updatedAt:          { type: Date, default: Date.now },
});

// ── Invoice: immutable record per billing cycle ───────────────────────────────
const invoiceSchema = new mongoose.Schema({
  agencyId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  subscriptionId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Subscription' },
  stripeInvoiceId: { type: String, unique: true, sparse: true },
  amountCents:     { type: Number, required: true },
  currency:        { type: String, default: 'xaf' },           // CFA Franc for Cameroon
  status:          { type: String, enum: ['draft', 'open', 'paid', 'uncollectible', 'void'], default: 'open' },
  periodStart:     Date,
  periodEnd:       Date,
  pdfUrl:          String,
  paidAt:          Date,
  createdAt:       { type: Date, default: Date.now },
});

invoiceSchema.index({ agencyId: 1, createdAt: -1 });

const Plan         = mongoose.model('Plan',         planSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Invoice      = mongoose.model('Invoice',      invoiceSchema);

module.exports = { Plan, Subscription, Invoice };