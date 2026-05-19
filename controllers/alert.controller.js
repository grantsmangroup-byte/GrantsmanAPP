const SOSAlert    = require('../models/SOSAlert');
const WelfareCall = require('../models/WelfareCall');
const Guard       = require('../models/Guard');
const Incident    = require('../models/Incident');

// ── GET /api/alerts  — unified alert feed ─────────────────────────────────────
exports.getAlertFeed = async (req, res) => {
  try {
    const { limit = 50, since } = req.query;
    const dateFilter = since ? { $gte: new Date(since) } : { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };

    const [sosList, missedWelfare, criticalIncidents] = await Promise.all([
      // Active SOS alerts
      SOSAlert.find({ agencyId: req.agencyId, status: 'active' })
        .populate('guardId', 'name phone')
        .populate('siteId', 'name')
        .sort({ triggeredAt: -1 })
        .limit(20),

      // Missed welfare checks in window
      WelfareCall.find({ agencyId: req.agencyId, status: 'missed', scheduledAt: dateFilter })
        .populate('guardId', 'name')
        .populate('siteId', 'name')
        .sort({ scheduledAt: -1 })
        .limit(Number(limit)),

      // High/critical open incidents
      Incident.find({
        agencyId: req.agencyId,
        status:   'open',
        severity: { $in: ['high', 'critical'] },
        reportedAt: dateFilter,
      })
        .populate('guardId', 'name')
        .populate('siteId', 'name')
        .sort({ reportedAt: -1 })
        .limit(20),
    ]);

    // Normalise into a unified list with type tag
    const feed = [
      ...sosList.map((a) => ({
        type:      'sos',
        severity:  'critical',
        id:        a._id,
        title:     `SOS — ${a.guardId?.name}`,
        subtitle:  a.siteId?.name,
        timestamp: a.triggeredAt,
        raw:       a,
      })),
      ...missedWelfare.map((w) => ({
        type:      'welfare_missed',
        severity:  'high',
        id:        w._id,
        title:     `Missed check — ${w.guardId?.name}`,
        subtitle:  w.siteId?.name,
        timestamp: w.scheduledAt,
        raw:       w,
      })),
      ...criticalIncidents.map((i) => ({
        type:      'incident',
        severity:  i.severity,
        id:        i._id,
        title:     i.title,
        subtitle:  i.siteId?.name,
        timestamp: i.reportedAt,
        raw:       i,
      })),
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Summary counts
    const summary = {
      activeSOS:        sosList.length,
      missedChecks:     missedWelfare.length,
      openIncidents:    criticalIncidents.length,
      totalAlerts:      feed.length,
    };

    return res.json({ success: true, data: { feed: feed.slice(0, Number(limit)), summary } });
  } catch (err) {
    console.error('getAlertFeed:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load alerts' } });
  }
};

// ── GET /api/alerts/late-clockins ─────────────────────────────────────────────
// Guards whose shift should have started but haven't clocked in
exports.getLateClockIns = async (req, res) => {
  try {
    const now        = new Date();
    const timeStr    = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const graceMs    = 15 * 60 * 1000; // 15-minute grace period

    // Find off-duty guards whose shift start was more than 15 min ago
    const guards = await Guard.find({ agencyId: req.agencyId, status: 'off-duty', isActive: true })
      .populate('assignedSiteId', 'name');

    const late = guards.filter((g) => {
      if (!g.shiftStart) return false;
      const [h, m]     = g.shiftStart.split(':').map(Number);
      const shiftStart = new Date(now);
      shiftStart.setHours(h, m, 0, 0);
      return now - shiftStart > graceMs && now - shiftStart < 4 * 60 * 60 * 1000; // within 4h window
    });

    return res.json({
      success: true,
      data: late.map((g) => ({
        guardId:    g._id,
        guardName:  g.name,
        site:       g.assignedSiteId?.name,
        shiftStart: g.shiftStart,
        minutesLate: Math.round((now - (() => {
          const [h, m] = g.shiftStart.split(':').map(Number);
          const d = new Date(now); d.setHours(h, m, 0, 0); return d;
        })()) / 60000),
      })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to check clock-ins' } });
  }
};