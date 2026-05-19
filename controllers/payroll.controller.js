const Shift = require('../models/Shift');
const Guard = require('../models/Guard');

/**
 * Compute payroll summary for all guards in an agency for a date range.
 * Returns rows suitable for CSV export or direct display.
 *
 * @param {ObjectId} agencyId
 * @param {Date}     from
 * @param {Date}     to
 * @returns {Promise<Array>}
 */
async function computePayroll(agencyId, from, to) {
  const shifts = await Shift.find({
    agencyId,
    status:       'completed',
    clockInTime:  { $gte: from },
    clockOutTime: { $lte: to },
  })
    .populate('guardId', 'name phone shiftStart shiftEnd')
    .populate('siteId',  'name')
    .lean();

  // Aggregate by guard
  const byGuard = {};

  for (const shift of shifts) {
    const gid  = String(shift.guardId?._id || shift.guardId);
    const name = shift.guardId?.name || 'Unknown';

    if (!byGuard[gid]) {
      byGuard[gid] = {
        guardId:       gid,
        guardName:     name,
        phone:         shift.guardId?.phone || '',
        totalShifts:   0,
        totalMinutes:  0,
        regularMinutes:0,
        overtimeMinutes:0,
        sites:         new Set(),
        shifts:        [],
      };
    }

    const entry = byGuard[gid];
    const durationMs = new Date(shift.clockOutTime) - new Date(shift.clockInTime);
    const minutes    = Math.round(durationMs / 60000);

    // Anything over 8h in a single shift counts as overtime
    const regularMins  = Math.min(minutes, 480);
    const overtimeMins = Math.max(0, minutes - 480);

    entry.totalShifts    += 1;
    entry.totalMinutes   += minutes;
    entry.regularMinutes += regularMins;
    entry.overtimeMinutes+= overtimeMins;
    entry.sites.add(shift.siteId?.name || 'Unknown');
    entry.shifts.push({
      date:      shift.clockInTime.toISOString().slice(0, 10),
      site:      shift.siteId?.name,
      clockIn:   shift.clockInTime,
      clockOut:  shift.clockOutTime,
      minutes,
    });
  }

  return Object.values(byGuard).map((g) => ({
    ...g,
    totalHours:    +(g.totalMinutes    / 60).toFixed(2),
    regularHours:  +(g.regularMinutes  / 60).toFixed(2),
    overtimeHours: +(g.overtimeMinutes / 60).toFixed(2),
    sites:         [...g.sites].join(', '),
  }));
}

/**
 * Generate CSV string from payroll rows.
 */
function toCSV(rows) {
  if (!rows.length) return '';

  const headers = [
    'Guard Name', 'Phone', 'Total Shifts',
    'Regular Hours', 'Overtime Hours', 'Total Hours', 'Sites',
  ];

  const lines = rows.map((r) =>
    [
      `"${r.guardName}"`,
      `"${r.phone}"`,
      r.totalShifts,
      r.regularHours,
      r.overtimeHours,
      r.totalHours,
      `"${r.sites}"`,
    ].join(',')
  );

  return [headers.join(','), ...lines].join('\n');
}

// ── Controller ────────────────────────────────────────────────────────────────

exports.getPayrollSummary = async (req, res) => {
  try {
    const { from, to, format = 'json' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ success: false, error: { message: 'from and to dates required' } });
    }

    const rows = await computePayroll(req.agencyId, new Date(from), new Date(to));

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="payroll-${from}-${to}.csv"`);
      return res.send(toCSV(rows));
    }

    return res.json({ success: true, data: { rows, from, to } });
  } catch (err) {
    console.error('getPayrollSummary:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to compute payroll' } });
  }
};