const ScheduledShift = require('../models/ScheduledShift');
const Guard          = require('../models/Guard');
const audit          = require('../services/audit.service');
const push           = require('../services/push.service');

// ── POST /api/schedule  — create one or many shifts (bulk OK) ─────────────────
exports.createShifts = async (req, res) => {
  try {
    // Accept single object or array
    const entries = Array.isArray(req.body) ? req.body : [req.body];

    const docs = entries.map((e) => ({
      agencyId:  req.agencyId,
      guardId:   e.guardId,
      siteId:    e.siteId,
      date:      e.date,
      startTime: e.startTime,
      endTime:   e.endTime,
      type:      e.type || 'regular',
      notes:     e.notes,
      createdBy: req.userId,
    }));

    // insertMany with ordered:false so one duplicate doesn't block the rest
    const result = await ScheduledShift.insertMany(docs, { ordered: false });

    await audit.log({ action: 'schedule.shifts_created', req, entityType: 'ScheduledShift', after: { count: result.length } });

    // Notify each guard about their new shift
    const guardIds = [...new Set(docs.map((d) => String(d.guardId)))];
    const guards   = await Guard.find({ _id: { $in: guardIds } });
    await Promise.all(
      guards.map((g) =>
        g.pushToken
          ? push.notifyShiftReminder(g, `New shift scheduled for ${docs.find((d) => String(d.guardId) === String(g._id))?.date}`)
          : null
      )
    );

    return res.status(201).json({ success: true, data: { created: result.length } });
  } catch (err) {
    // Partial success on duplicate key errors
    if (err.code === 11000) {
      return res.status(207).json({
        success: false,
        error: { message: 'Some shifts were skipped due to double-booking', code: 'PARTIAL_CONFLICT' },
      });
    }
    console.error('createShifts:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to create shifts' } });
  }
};

// ── GET /api/schedule?week=YYYY-WW  — week roster ─────────────────────────────
exports.getWeekRoster = async (req, res) => {
  try {
    const { week, siteId, guardId } = req.query;

    // Derive date range from ISO week string "2025-W22"
    let from, to;
    if (week) {
      const [year, w] = week.split('-W').map(Number);
      const jan4      = new Date(year, 0, 4);
      const startOfW1 = new Date(jan4);
      startOfW1.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1));
      const weekStart = new Date(startOfW1);
      weekStart.setDate(startOfW1.getDate() + (w - 1) * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      from = weekStart.toISOString().slice(0, 10);
      to   = weekEnd.toISOString().slice(0, 10);
    } else {
      from = req.query.from;
      to   = req.query.to;
    }

    if (!from || !to) {
      return res.status(400).json({ success: false, error: { message: 'Provide week or from+to' } });
    }

    const filter = { agencyId: req.agencyId, date: { $gte: from, $lte: to } };
    if (siteId)  filter.siteId  = siteId;
    if (guardId) filter.guardId = guardId;

    const shifts = await ScheduledShift.find(filter)
      .populate('guardId', 'name phone')
      .populate('siteId', 'name')
      .sort({ date: 1, startTime: 1 });

    return res.json({ success: true, data: { from, to, shifts } });
  } catch (err) {
    console.error('getWeekRoster:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load roster' } });
  }
};

// ── DELETE /api/schedule/:id ──────────────────────────────────────────────────
exports.cancelShift = async (req, res) => {
  try {
    const shift = await ScheduledShift.findOneAndUpdate(
      { _id: req.params.id, agencyId: req.agencyId },
      { status: 'cancelled' },
      { new: true }
    );
    if (!shift) return res.status(404).json({ success: false, error: { message: 'Shift not found' } });
    await audit.log({ action: 'schedule.shift_cancelled', req, entityType: 'ScheduledShift', entityId: shift._id });
    return res.json({ success: true, data: shift });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to cancel shift' } });
  }
};

// ── POST /api/schedule/:id/swap ───────────────────────────────────────────────
exports.requestSwap = async (req, res) => {
  try {
    const { newGuardId } = req.body;
    const shift = await ScheduledShift.findOne({ _id: req.params.id, agencyId: req.agencyId });
    if (!shift) return res.status(404).json({ success: false, error: { message: 'Shift not found' } });

    shift.originalGuardId = shift.guardId;
    shift.guardId         = newGuardId;
    shift.type            = 'cover';
    shift.status          = 'scheduled';
    shift.swapRequestedAt = new Date();
    shift.swapApprovedBy  = req.userId;
    await shift.save();

    await audit.log({ action: 'schedule.shift_swapped', req, entityType: 'ScheduledShift', entityId: shift._id, after: { newGuardId } });
    return res.json({ success: true, data: shift });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to swap shift' } });
  }
};

// ── GET /api/guard/schedule — guard's upcoming shifts ─────────────────────────
exports.getGuardSchedule = async (req, res) => {
  try {
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) return res.status(404).json({ success: false, error: { message: 'Guard not found' } });

    const today = new Date().toISOString().slice(0, 10);
    const shifts = await ScheduledShift.find({
      guardId: guard._id,
      date:    { $gte: today },
      status:  { $in: ['scheduled', 'completed'] },
    })
      .populate('siteId', 'name address')
      .sort({ date: 1, startTime: 1 })
      .limit(14);

    return res.json({ success: true, data: shifts });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to load schedule' } });
  }
};