const router = require('express').Router();
const { authenticate, authorize } = require('../middleware/auth.middleware');
const User = require('../models/User');
const Guard = require('../models/Guard');
const Site = require('../models/Site');
const WelfareCall = require('../models/WelfareCall');
const SOSAlert = require('../models/SOSAlert');
const LocationPing = require('../models/LocationPing');

const parseDate = (value, fallback = null) => {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
};

const getDateRange = (query) => {
  const fromDate = parseDate(query.from, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const toDate = parseDate(query.to, new Date());
  return { fromDate, toDate };
};

const objectIdToString = (value) => value?.toString?.() || String(value);

const buildGuardMetrics = async ({ agencyId, guardIds, fromDate, toDate }) => {
  const pingRows = await LocationPing.aggregate([
    {
      $match: {
        agencyId,
        guardId: { $in: guardIds },
        timestamp: { $gte: fromDate, $lte: toDate }
      }
    },
    {
      $group: {
        _id: '$guardId',
        totalPings: { $sum: 1 },
        insidePings: {
          $sum: {
            $cond: [{ $eq: ['$withinGeofence', true] }, 1, 0]
          }
        },
        outsidePings: {
          $sum: {
            $cond: [{ $eq: ['$withinGeofence', false] }, 1, 0]
          }
        },
        lastPingAt: { $max: '$timestamp' }
      }
    }
  ]);

  const welfareRows = await WelfareCall.aggregate([
    {
      $match: {
        agencyId,
        guardId: { $in: guardIds },
        scheduledAt: { $gte: fromDate, $lte: toDate }
      }
    },
    {
      $group: {
        _id: '$guardId',
        totalCalls: { $sum: 1 },
        answeredCalls: {
          $sum: {
            $cond: [{ $eq: ['$status', 'answered'] }, 1, 0]
          }
        },
        missedCalls: {
          $sum: {
            $cond: [{ $eq: ['$status', 'missed'] }, 1, 0]
          }
        }
      }
    }
  ]);

  const sosRows = await SOSAlert.aggregate([
    {
      $match: {
        agencyId,
        guardId: { $in: guardIds },
        triggeredAt: { $gte: fromDate, $lte: toDate }
      }
    },
    {
      $group: {
        _id: '$guardId',
        totalSOS: { $sum: 1 },
        activeSOS: {
          $sum: {
            $cond: [{ $eq: ['$status', 'active'] }, 1, 0]
          }
        }
      }
    }
  ]);

  const pingMap = new Map(pingRows.map((row) => [objectIdToString(row._id), row]));
  const welfareMap = new Map(welfareRows.map((row) => [objectIdToString(row._id), row]));
  const sosMap = new Map(sosRows.map((row) => [objectIdToString(row._id), row]));

  return { pingMap, welfareMap, sosMap };
};

// All routes require agency admin auth
router.use(authenticate, authorize('agency-admin'));

// ========== DASHBOARD ==========
router.get('/dashboard', async (req, res) => {
  try {
    const agencyId = req.user.agencyId;

    const activeGuardFilter = {
      agencyId,
      $or: [{ isActive: true }, { isActive: { $exists: false } }]
    };
    const activeSiteFilter = {
      agencyId,
      $or: [{ isActive: true }, { isActive: { $exists: false } }]
    };

    const totalGuards = await Guard.countDocuments(activeGuardFilter);
    const onDutyGuards = await Guard.countDocuments({
      ...activeGuardFilter,
      status: 'on-duty'
    });
    const totalSites = await Site.countDocuments(activeSiteFilter);
    const activeSOS = await SOSAlert.countDocuments({ agencyId, status: 'active' });

    // Recent welfare checks
    const recentCalls = await WelfareCall.find({ agencyId })
      .sort({ answeredAt: -1 })
      .limit(5)
      .populate('guardId', 'name phone')
      .populate('siteId', 'name');

    res.json({
      success: true,
      data: {
        stats: {
          totalGuards,
          onDutyGuards,
          totalSites,
          activeSOS
        },
        recentCalls
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== ANALYTICS ==========
router.get('/analytics', async (req, res) => {
  try {
    const agencyId = req.user.agencyId;

    const callQuery = { agencyId };
    const totalCalls = await WelfareCall.countDocuments(callQuery);
    const answeredCalls = await WelfareCall.countDocuments({
      ...callQuery,
      status: 'answered'
    });
    const missedCalls = await WelfareCall.countDocuments({
      ...callQuery,
      status: 'missed'
    });

    const responseRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

    const guardStats = await Guard.aggregate([
      { $match: { agencyId } },
      {
        $group: {
          _id: null,
          avgAlertness: { $avg: '$alertnessScore' },
          totalGuards: { $sum: 1 }
        }
      }
    ]);

    const avgAlertness = guardStats[0]?.avgAlertness ? Math.round(guardStats[0].avgAlertness) : 0;
    const totalGuards = guardStats[0]?.totalGuards || 0;
    const totalSites = await Site.countDocuments({ agencyId });

    res.json({
      success: true,
      data: {
        responseRate,
        totalCalls,
        answeredCalls,
        missedCalls,
        avgAlertness,
        totalGuards,
        totalSites
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== REPORTING ==========

// Guard report rows with filters
router.get('/reports/guards', async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const { fromDate, toDate } = getDateRange(req.query);

    const guardMatch = {
      agencyId,
      $or: [{ isActive: true }, { isActive: { $exists: false } }]
    };

    if (req.query.guardId) {
      guardMatch._id = req.query.guardId;
    }
    if (req.query.status) {
      guardMatch.status = req.query.status;
    }
    if (req.query.shiftStart) {
      guardMatch.shiftStart = req.query.shiftStart;
    }
    if (req.query.shiftEnd) {
      guardMatch.shiftEnd = req.query.shiftEnd;
    }
    if (req.query.search) {
      guardMatch.name = { $regex: req.query.search, $options: 'i' };
    }

    const guards = await Guard.find(guardMatch)
      .populate('assignedSiteId', 'name')
      .sort({ name: 1 });

    const guardIds = guards.map((guard) => guard._id);
    if (!guardIds.length) {
      return res.json({ success: true, data: { rows: [], filters: { fromDate, toDate } } });
    }

    const { pingMap, welfareMap, sosMap } = await buildGuardMetrics({
      agencyId,
      guardIds,
      fromDate,
      toDate,
    });

    const rows = guards.map((guard) => {
      const key = objectIdToString(guard._id);
      const ping = pingMap.get(key) || {};
      const welfare = welfareMap.get(key) || {};
      const sos = sosMap.get(key) || {};
      const totalCalls = welfare.totalCalls || 0;
      const answeredCalls = welfare.answeredCalls || 0;

      return {
        guardId: guard._id,
        name: guard.name,
        phone: guard.phone,
        status: guard.status,
        siteName: guard.assignedSiteId?.name || 'Unassigned',
        shiftStart: guard.shiftStart,
        shiftEnd: guard.shiftEnd,
        alertnessScore: guard.alertnessScore || 0,
        totalPings: ping.totalPings || 0,
        insidePings: ping.insidePings || 0,
        outsidePings: ping.outsidePings || 0,
        lastPingAt: ping.lastPingAt || null,
        totalCalls,
        answeredCalls,
        missedCalls: welfare.missedCalls || 0,
        responseRate: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0,
        totalSOS: sos.totalSOS || 0,
        activeSOS: sos.activeSOS || 0,
      };
    });

    res.json({
      success: true,
      data: {
        rows,
        filters: { fromDate, toDate },
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Single guard detailed report
router.get('/reports/guards/:guardId', async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const { fromDate, toDate } = getDateRange(req.query);
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);

    const guard = await Guard.findOne({
      _id: req.params.guardId,
      agencyId,
    }).populate('assignedSiteId', 'name address geofenceRadius');

    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    const [pings, welfareCalls, sosAlerts] = await Promise.all([
      LocationPing.find({
        agencyId,
        guardId: guard._id,
        timestamp: { $gte: fromDate, $lte: toDate }
      })
        .sort({ timestamp: -1 })
        .limit(limit),
      WelfareCall.find({
        agencyId,
        guardId: guard._id,
        scheduledAt: { $gte: fromDate, $lte: toDate }
      })
        .sort({ scheduledAt: -1 })
        .limit(limit),
      SOSAlert.find({
        agencyId,
        guardId: guard._id,
        triggeredAt: { $gte: fromDate, $lte: toDate }
      })
        .sort({ triggeredAt: -1 })
        .limit(limit)
    ]);

    const totalCalls = welfareCalls.length;
    const answeredCalls = welfareCalls.filter((call) => call.status === 'answered').length;

    res.json({
      success: true,
      data: {
        guard,
        summary: {
          totalPings: pings.length,
          insidePings: pings.filter((ping) => ping.withinGeofence === true).length,
          outsidePings: pings.filter((ping) => ping.withinGeofence === false).length,
          totalCalls,
          answeredCalls,
          missedCalls: welfareCalls.filter((call) => call.status === 'missed').length,
          responseRate: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0,
          totalSOS: sosAlerts.length,
          activeSOS: sosAlerts.filter((alert) => alert.status === 'active').length,
        },
        pings,
        welfareCalls,
        sosAlerts,
        filters: { fromDate, toDate, limit },
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Shift report (all guards on same shift)
router.get('/reports/shifts', async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const { fromDate, toDate } = getDateRange(req.query);
    const shiftStart = req.query.shiftStart;
    const shiftEnd = req.query.shiftEnd;

    if (!shiftStart || !shiftEnd) {
      return res.status(400).json({ success: false, message: 'shiftStart and shiftEnd are required' });
    }

    const guards = await Guard.find({
      agencyId,
      shiftStart,
      shiftEnd,
      $or: [{ isActive: true }, { isActive: { $exists: false } }]
    }).populate('assignedSiteId', 'name');

    const guardIds = guards.map((guard) => guard._id);
    if (!guardIds.length) {
      return res.json({
        success: true,
        data: {
          shift: { shiftStart, shiftEnd },
          rows: [],
          summary: {
            totalGuards: 0,
            totalPings: 0,
            totalCalls: 0,
            totalMissedCalls: 0,
            avgResponseRate: 0,
          }
        }
      });
    }

    const { pingMap, welfareMap } = await buildGuardMetrics({ agencyId, guardIds, fromDate, toDate });

    const rows = guards.map((guard) => {
      const key = objectIdToString(guard._id);
      const ping = pingMap.get(key) || {};
      const welfare = welfareMap.get(key) || {};
      const totalCalls = welfare.totalCalls || 0;
      const answeredCalls = welfare.answeredCalls || 0;

      return {
        guardId: guard._id,
        name: guard.name,
        phone: guard.phone,
        siteName: guard.assignedSiteId?.name || 'Unassigned',
        status: guard.status,
        totalPings: ping.totalPings || 0,
        insidePings: ping.insidePings || 0,
        outsidePings: ping.outsidePings || 0,
        totalCalls,
        missedCalls: welfare.missedCalls || 0,
        responseRate: totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0,
      };
    });

    const summary = {
      totalGuards: rows.length,
      totalPings: rows.reduce((sum, row) => sum + row.totalPings, 0),
      totalCalls: rows.reduce((sum, row) => sum + row.totalCalls, 0),
      totalMissedCalls: rows.reduce((sum, row) => sum + row.missedCalls, 0),
      avgResponseRate: rows.length
        ? Math.round(rows.reduce((sum, row) => sum + row.responseRate, 0) / rows.length)
        : 0,
    };

    res.json({
      success: true,
      data: {
        shift: { shiftStart, shiftEnd },
        rows,
        summary,
        filters: { fromDate, toDate }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Daily location ping report
router.get('/reports/pings/daily', async (req, res) => {
  try {
    const agencyId = req.user.agencyId;
    const { fromDate, toDate } = getDateRange(req.query);
    const match = {
      agencyId,
      timestamp: { $gte: fromDate, $lte: toDate },
    };

    if (req.query.guardId) {
      match.guardId = req.query.guardId;
    }
    if (req.query.siteId) {
      match.siteId = req.query.siteId;
    }

    const daily = await LocationPing.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
            guardId: '$guardId'
          },
          totalPings: { $sum: 1 },
          insidePings: {
            $sum: {
              $cond: [{ $eq: ['$withinGeofence', true] }, 1, 0]
            }
          },
          outsidePings: {
            $sum: {
              $cond: [{ $eq: ['$withinGeofence', false] }, 1, 0]
            }
          },
          avgAccuracy: { $avg: '$accuracy' },
          firstPing: { $min: '$timestamp' },
          lastPing: { $max: '$timestamp' },
        }
      },
      {
        $lookup: {
          from: 'guards',
          localField: '_id.guardId',
          foreignField: '_id',
          as: 'guard'
        }
      },
      {
        $project: {
          _id: 0,
          day: '$_id.day',
          guardId: '$_id.guardId',
          guardName: { $ifNull: [{ $arrayElemAt: ['$guard.name', 0] }, 'Unknown'] },
          totalPings: 1,
          insidePings: 1,
          outsidePings: 1,
          avgAccuracy: { $round: ['$avgAccuracy', 2] },
          firstPing: 1,
          lastPing: 1,
        }
      },
      { $sort: { day: -1, guardName: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        rows: daily,
        filters: { fromDate, toDate }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== GUARD MANAGEMENT ==========

// Create Guard
router.post('/guards', async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      password,
      device,
      assignedSiteId,
      shiftStart,
      shiftEnd,
      status,
      userId
    } = req.body;

    let resolvedUserId = userId;

    if (!resolvedUserId) {
      const safePhone = String(phone || '').replace(/\D/g, '');
      const generatedEmail = safePhone ? `${safePhone}@guard.local` : undefined;
      const userEmail = email || generatedEmail;

      if (!userEmail) {
        return res.status(400).json({ success: false, message: 'Email is required to create a guard account' });
      }

      const existingUser = await User.findOne({
        $or: [{ email: userEmail }, { phone }]
      });

      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Guard user already exists' });
      }

      const user = await User.create({
        fullName: name,
        email: userEmail,
        phone,
        password: password || 'guard123',
        role: 'guard',
        agencyId: req.user.agencyId,
        isActive: true
      });

      resolvedUserId = user._id;
    }

    const guard = new Guard({
      userId: resolvedUserId,
      agencyId: req.user.agencyId,
      name,
      phone,
      device,
      assignedSiteId,
      shiftStart,
      shiftEnd,
      status: status || 'off-duty',
      isActive: true
    });
    await guard.save();

    // If assigned to a site, add to site's guard list
    if (guard.assignedSiteId) {
      await Site.findByIdAndUpdate(
        guard.assignedSiteId,
        { $addToSet: { assignedGuards: guard._id } }
      );
    }

    res.status(201).json({
      success: true,
      data: guard,
      message: 'Guard created successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get All Guards
router.get('/guards', async (req, res) => {
  try {
    const guards = await Guard.find({
      agencyId: req.user.agencyId,
      $or: [{ isActive: true }, { isActive: { $exists: false } }]
    })
    .populate('assignedSiteId', 'name')
    .sort({ createdAt: -1 });

    res.json({ success: true, data: guards });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Single Guard
router.get('/guards/:id', async (req, res) => {
  try {
    const guard = await Guard.findOne({
      _id: req.params.id,
      agencyId: req.user.agencyId
    }).populate('assignedSiteId');

    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    // Get recent welfare calls
    const recentCalls = await WelfareCall.find({ guardId: guard._id })
      .sort({ scheduledAt: -1 })
      .limit(10);

    res.json({ success: true, data: { guard, recentCalls } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Guard
router.put('/guards/:id', async (req, res) => {
  try {
    const guard = await Guard.findOneAndUpdate(
      { _id: req.params.id, agencyId: req.user.agencyId },
      req.body,
      { new: true }
    );

    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    // Update site assignments
    if (req.body.assignedSiteId) {
      await Site.findByIdAndUpdate(
        req.body.assignedSiteId,
        { $addToSet: { assignedGuards: guard._id } }
      );
    }

    res.json({ success: true, data: guard });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Guard (soft delete)
router.delete('/guards/:id', async (req, res) => {
  try {
    const guard = await Guard.findOneAndUpdate(
      { _id: req.params.id, agencyId: req.user.agencyId },
      { isActive: false },
      { new: true }
    );

    if (!guard) {
      return res.status(404).json({ success: false, message: 'Guard not found' });
    }

    if (guard.userId) {
      await User.findByIdAndUpdate(guard.userId, { isActive: false });
    }

    res.json({ success: true, message: 'Guard removed successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== SITE MANAGEMENT ==========

// Create Site
router.post('/sites', async (req, res) => {
  try {
    const siteData = {
      ...req.body,
      agencyId: req.user.agencyId
    };

    const site = new Site({
      ...siteData,
      isActive: true
    });
    await site.save();

    res.status(201).json({
      success: true,
      data: site,
      message: 'Site created successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get All Sites
router.get('/sites', async (req, res) => {
  try {
    const sites = await Site.find({
      agencyId: req.user.agencyId,
      $or: [{ isActive: true }, { isActive: { $exists: false } }]
    })
    .populate('assignedGuards', 'fullName status')
    .sort({ createdAt: -1 });

    res.json({ success: true, data: sites });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Single Site
router.get('/sites/:id', async (req, res) => {
  try {
    const site = await Site.findOne({
      _id: req.params.id,
      agencyId: req.user.agencyId
    }).populate('assignedGuards');

    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    res.json({ success: true, data: site });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Site
router.put('/sites/:id', async (req, res) => {
  try {
    const site = await Site.findOneAndUpdate(
      { _id: req.params.id, agencyId: req.user.agencyId },
      req.body,
      { new: true }
    );

    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    res.json({ success: true, data: site });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Site (soft delete)
router.delete('/sites/:id', async (req, res) => {
  try {
    const site = await Site.findOneAndUpdate(
      { _id: req.params.id, agencyId: req.user.agencyId },
      { isActive: false },
      { new: true }
    );

    if (!site) {
      return res.status(404).json({ success: false, message: 'Site not found' });
    }

    res.json({ success: true, message: 'Site deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;