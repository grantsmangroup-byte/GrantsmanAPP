const Guard = require('../models/Guard');
const Shift = require('../models/Shift');
const WelfareCall = require('../models/WelfareCall');
const Site = require('../models/Site');
const { isWithinGeofence } = require('../utils/geofence');

exports.getDashboard = async (req, res) => {
  try {
    const guard = await Guard.findOne({ userId: req.userId });
    
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    // Get today's welfare calls
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayCalls = await WelfareCall.find({
      guardId: guard._id,
      scheduledAt: { $gte: today }
    });

    const totalChecks = todayCalls.length;
    const answeredChecks = todayCalls.filter(c => c.status === 'answered').length;

    res.json({
      success: true,
      data: {
        guardId: guard._id,
        status: guard.status,
        alertnessScore: guard.alertnessScore,
        totalChecks: totalChecks,
        answeredChecks: answeredChecks,
        currentLocation: guard.lastLocationUpdate || null,
        assignedSite: await Site.findById(guard.assignedSiteId)
      }
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to load dashboard', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.clockIn = async (req, res) => {
  try {
    const { latitude, longitude } = req.body.location || req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Location coordinates required', code: 'INVALID_LOCATION' }
      });
    }

    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    // Check if already on duty
    if (guard.status === 'on-duty') {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Already clocked in', code: 'ALREADY_CLOCKED_IN' }
      });
    }

    // Validate location against site geofence
    const site = await Site.findById(guard.assignedSiteId);
    if (site) {
      const withinGeofence = isWithinGeofence(
        latitude, 
        longitude, 
        site.latitude, 
        site.longitude, 
        site.geofenceRadius
      );

      if (!withinGeofence) {
        return res.status(400).json({ 
          success: false, 
          error: { 
            message: 'You are not at your assigned site', 
            code: 'OUTSIDE_GEOFENCE' 
          }
        });
      }
    }

    // Create new shift
    const shift = new Shift({
      guardId: guard._id,
      agencyId: guard.agencyId,
      siteId: guard.assignedSiteId,
      clockInTime: new Date(),
      clockInLocation: { latitude, longitude },
      status: 'active'
    });
    await shift.save();

    // Update guard status
    guard.status = 'on-duty';
    guard.currentShiftId = shift._id;
    guard.lastLocationUpdate = {
      latitude,
      longitude,
      timestamp: new Date()
    };
    await guard.save();

    res.json({
      success: true,
      data: {
        shiftId: shift._id,
        clockInTime: shift.clockInTime,
        status: 'on-duty'
      }
    });
  } catch (error) {
    console.error('Clock in error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to clock in', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.clockOut = async (req, res) => {
  try {
    const { latitude, longitude } = req.body.location || req.body;
    
    if (!latitude || !longitude) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Location coordinates required', code: 'INVALID_LOCATION' }
      });
    }

    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    if (guard.status !== 'on-duty') {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Not currently clocked in', code: 'NOT_CLOCKED_IN' }
      });
    }

    // Update current shift
    const shift = await Shift.findById(guard.currentShiftId);
    if (!shift) {
      return res.status(404).json({
        success: false,
        error: { message: 'Active shift not found', code: 'SHIFT_NOT_FOUND' }
      });
    }

    shift.clockOutTime = new Date();
    shift.clockOutLocation = { latitude, longitude };
    shift.status = 'completed';
    await shift.save();

    // Update guard status
    guard.status = 'off-duty';
    guard.currentShiftId = null;
    await guard.save();

    res.json({
      success: true,
      data: {
        clockOutTime: shift.clockOutTime,
        status: 'off-duty',
        shiftDuration: shift.clockOutTime - shift.clockInTime
      }
    });
  } catch (error) {
    console.error('Clock out error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to clock out', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.getShiftStatus = async (req, res) => {
  try {
    const guard = await Guard.findOne({ userId: req.userId });
    
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    let currentShift = null;
    if (guard.currentShiftId) {
      currentShift = await Shift.findById(guard.currentShiftId);
    }

    res.json({
      success: true,
      data: {
        status: guard.status,
        currentShift: currentShift,
        shiftStart: guard.shiftStart,
        shiftEnd: guard.shiftEnd
      }
    });
  } catch (error) {
    console.error('Get shift status error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to get shift status', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.getCheckHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    const checks = await WelfareCall.find({ guardId: guard._id })
      .sort({ scheduledAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await WelfareCall.countDocuments({ guardId: guard._id });

    res.json({
      success: true,
      data: {
        checks,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get check history error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to load history', code: 'INTERNAL_ERROR' }
    });
  }
};