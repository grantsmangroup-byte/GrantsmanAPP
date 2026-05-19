const Agency       = require('../models/Agency');
const User         = require('../models/User');
const Guard        = require('../models/Guard');
const Site         = require('../models/Site');
const { Subscription } = require('../models/Billing');
const audit        = require('../services/audit.service');
const jwt          = require('jsonwebtoken');

// ── GET /api/superadmin/agencies ─────────────────────────────────────────────
exports.listAgencies = async (req, res) => {
  try {
    const { page = 1, limit = 30, status, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) filter.name   = { $regex: search, $options: 'i' };

    const [agencies, total] = await Promise.all([
      Agency.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Agency.countDocuments(filter),
    ]);

    // Enrich with live counts
    const enriched = await Promise.all(
      agencies.map(async (a) => {
        const [guardCount, siteCount, sub] = await Promise.all([
          Guard.countDocuments({ agencyId: a._id }),
          Site.countDocuments({ agencyId: a._id }),
          Subscription.findOne({ agencyId: a._id }).populate('planId', 'name'),
        ]);
        return { ...a.toObject(), guardCount, siteCount, subscription: sub };
      })
    );

    return res.json({
      success: true,
      data: { agencies: enriched, pagination: { page: Number(page), limit: Number(limit), total } },
    });
  } catch (err) {
    console.error('superadmin.listAgencies:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to list agencies' } });
  }
};

// ── PATCH /api/superadmin/agencies/:id/status ─────────────────────────────────
exports.setAgencyStatus = async (req, res) => {
  try {
    const { status } = req.body; // 'active' | 'suspended'
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid status' } });
    }

    const agency = await Agency.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!agency) return res.status(404).json({ success: false, error: { message: 'Agency not found' } });

    // If suspending, deactivate all users in that agency
    if (status === 'suspended') {
      await User.updateMany({ agencyId: agency._id }, { isActive: false });
    } else {
      await User.updateMany({ agencyId: agency._id }, { isActive: true });
    }

    await audit.log({ action: `superadmin.agency_${status}`, req, entityType: 'Agency', entityId: agency._id });

    return res.json({ success: true, data: agency });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to update agency status' } });
  }
};

// ── GET /api/superadmin/metrics ───────────────────────────────────────────────
exports.getPlatformMetrics = async (req, res) => {
  try {
    const [
      totalAgencies,
      activeAgencies,
      totalGuards,
      guardsOnDuty,
      totalSites,
      activeSubscriptions,
    ] = await Promise.all([
      Agency.countDocuments(),
      Agency.countDocuments({ status: 'active' }),
      Guard.countDocuments(),
      Guard.countDocuments({ status: 'on-duty' }),
      Site.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
    ]);

    // Monthly recurring revenue
    const subs = await Subscription.find({ status: 'active' }).populate('planId', 'monthlyPriceCents');
    const mrr  = subs.reduce((sum, s) => sum + (s.planId?.monthlyPriceCents || 0), 0);

    return res.json({
      success: true,
      data: {
        totalAgencies,
        activeAgencies,
        totalGuards,
        guardsOnDuty,
        totalSites,
        activeSubscriptions,
        mrrCents: mrr,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to load metrics' } });
  }
};

// ── POST /api/superadmin/agencies/:id/impersonate ─────────────────────────────
// Issues a short-lived token scoped to an agency-admin user for support purposes
exports.impersonateAgency = async (req, res) => {
  try {
    const adminUser = await User.findOne({ agencyId: req.params.id, role: 'agency-admin', isActive: true });
    if (!adminUser) {
      return res.status(404).json({ success: false, error: { message: 'No active admin for this agency' } });
    }

    const token = jwt.sign(
      { userId: adminUser._id, impersonatedBy: req.userId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    await audit.log({
      action:     'superadmin.impersonate',
      req,
      entityType: 'Agency',
      entityId:   req.params.id,
      after:      { impersonatedUserId: adminUser._id },
    });

    return res.json({ success: true, data: { token, expiresIn: '1h', agencyId: req.params.id } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Impersonation failed' } });
  }
};

// ── POST /api/superadmin/agencies  — create agency + seed admin user ──────────
exports.createAgency = async (req, res) => {
  try {
    const { name, adminName, email, phone, address, password } = req.body;

    const agency = await Agency.create({ name, adminName, email, phone, address });

    const adminUser = await User.create({
      fullName: adminName,
      email,
      phone,
      password: password || Math.random().toString(36).slice(2, 10),
      role:     'agency-admin',
      agencyId: agency._id,
    });

    await audit.log({ action: 'superadmin.agency_created', req, entityType: 'Agency', entityId: agency._id });

    return res.status(201).json({ success: true, data: { agency, adminUserId: adminUser._id } });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: { message: 'Email or phone already exists', code: 'DUPLICATE' } });
    }
    return res.status(500).json({ success: false, error: { message: 'Failed to create agency' } });
  }
};