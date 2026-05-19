/**
 * Agency Scope Middleware
 *
 * Adds req.scopedQuery(Model) which pre-applies agencyId filtering so
 * controllers can't accidentally query cross-tenant data.
 *
 * Usage in controller:
 *   const guards = await req.scopedQuery(Guard).find({ status: 'on-duty' });
 */

const rateLimit = require('express-rate-limit');

// ── Per-agency rate limiting ───────────────────────────────────────────────────
exports.agencyRateLimit = rateLimit({
  windowMs:        60 * 1000,  // 1 minute
  max:             300,
  keyGenerator:    (req) => String(req.agencyId || req.ip),
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
});

// ── Strict per-guard rate limit for location pings ────────────────────────────
exports.pingRateLimit = rateLimit({
  windowMs:        60 * 1000,
  max:             10,           // max 10 pings/min per guard
  keyGenerator:    (req) => `ping_${req.userId}`,
  message:         { success: false, error: { message: 'Ping rate limit exceeded', code: 'RATE_LIMITED' } },
});

// ── Scoped query helper injected into req ─────────────────────────────────────
exports.injectScopedQuery = (req, res, next) => {
  req.scopedQuery = (Model) => ({
    find:      (filter = {})        => Model.find({ agencyId: req.agencyId, ...filter }),
    findOne:   (filter = {})        => Model.findOne({ agencyId: req.agencyId, ...filter }),
    countDocuments: (filter = {})   => Model.countDocuments({ agencyId: req.agencyId, ...filter }),
    findOneAndUpdate: (filter, update, opts) =>
      Model.findOneAndUpdate({ agencyId: req.agencyId, ...filter }, update, opts),
    findOneAndDelete: (filter)      =>
      Model.findOneAndDelete({ agencyId: req.agencyId, ...filter }),
  });
  next();
};

// ── Guard: enforce guard belongs to the request's agency ─────────────────────
exports.verifyGuardBelongsToAgency = async (req, res, next) => {
  const Guard = require('../models/Guard');
  try {
    const guard = await Guard.findOne({ userId: req.userId, agencyId: req.agencyId });
    if (!guard) {
      return res.status(403).json({
        success: false,
        error: { message: 'Guard does not belong to this agency', code: 'FORBIDDEN' },
      });
    }
    req.guard = guard;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Scope check failed' } });
  }
};