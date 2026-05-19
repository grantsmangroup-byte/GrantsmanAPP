const Guard       = require('../models/Guard');
const Site        = require('../models/Site');
const Incident    = require('../models/Incident');
const WelfareCall = require('../models/WelfareCall');
const Shift       = require('../models/Shift');

// ── GET /api/client/overview ─────────────────────────────────────────────────
// Summary for all sites this client has access to
exports.getOverview = async (req, res) => {
  try {
    const siteIds = req.siteIds; // injected by authenticateClient middleware
    if (!siteIds?.length) {
      return res.json({ success: true, data: { sites: [], guardsOnDuty: 0, openIncidents: 0 } });
    }

    const [sites, guardsOnDuty, openIncidents] = await Promise.all([
      Site.find({ _id: { $in: siteIds } }).select('name address geofenceRadius'),
      Guard.countDocuments({ assignedSiteId: { $in: siteIds }, status: 'on-duty' }),
      Incident.countDocuments({ siteId: { $in: siteIds }, clientVisible: true, status: 'open' }),
    ]);

    return res.json({ success: true, data: { sites, guardsOnDuty, openIncidents } });
  } catch (err) {
    console.error('client.getOverview:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load overview' } });
  }
};

// ── GET /api/client/sites/:siteId/guards ─────────────────────────────────────
// Live guard status for one site
exports.getSiteGuards = async (req, res) => {
  try {
    const { siteId } = req.params;
    if (!req.siteIds.map(String).includes(siteId)) {
      return res.status(403).json({ success: false, error: { message: 'Access denied to this site' } });
    }

    const guards = await Guard.find({ assignedSiteId: siteId })
      .select('name status shiftStart shiftEnd lastLocationUpdate alertnessScore device');

    return res.json({ success: true, data: guards });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to load guards' } });
  }
};

// ── GET /api/client/sites/:siteId/incidents ───────────────────────────────────
// Client-visible incidents only
exports.getSiteIncidents = async (req, res) => {
  try {
    const { siteId } = req.params;
    if (!req.siteIds.map(String).includes(siteId)) {
      return res.status(403).json({ success: false, error: { message: 'Access denied to this site' } });
    }

    const { page = 1, limit = 20, status } = req.query;
    const filter = { siteId, clientVisible: true };
    if (status) filter.status = status;

    const [incidents, total] = await Promise.all([
      Incident.find(filter)
        .select('category severity title description status occurredAt reportedAt location attachments')
        .sort({ reportedAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Incident.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: { incidents, pagination: { page: Number(page), limit: Number(limit), total } },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to load incidents' } });
  }
};

// ── GET /api/client/sites/:siteId/activity ────────────────────────────────────
// Recent welfare checks (answered/missed) + clock-ins for a site — last 7 days
exports.getSiteActivity = async (req, res) => {
  try {
    const { siteId } = req.params;
    if (!req.siteIds.map(String).includes(siteId)) {
      return res.status(403).json({ success: false, error: { message: 'Access denied to this site' } });
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [welfare, shifts] = await Promise.all([
      WelfareCall.find({ siteId, scheduledAt: { $gte: since } })
        .populate('guardId', 'name')
        .select('status scheduledAt answeredAt guardId')
        .sort({ scheduledAt: -1 })
        .limit(50),
      Shift.find({ siteId, clockInTime: { $gte: since } })
        .populate('guardId', 'name')
        .select('guardId clockInTime clockOutTime status')
        .sort({ clockInTime: -1 })
        .limit(30),
    ]);

    return res.json({ success: true, data: { welfare, shifts } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to load activity' } });
  }
};