const mongoose = require('mongoose');

// ── Visitor log ───────────────────────────────────────────────────────────────
const visitorLogSchema = new mongoose.Schema({
  agencyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  siteId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Site',   required: true },
  loggedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'Guard',  required: true },

  visitorName:    { type: String, required: true, trim: true },
  idType:         { type: String, enum: ['national_id', 'passport', 'drivers_license', 'other'] },
  idNumber:       String,
  company:        String,
  purpose:        { type: String, required: true, trim: true },
  hostName:       String,      // person they are visiting
  badgeNumber:    String,

  photoUrl:       String,      // visitor photo capture

  entryTime:      { type: Date, default: Date.now },
  exitTime:       Date,
  status:         { type: String, enum: ['inside', 'exited'], default: 'inside' },
});

visitorLogSchema.index({ siteId: 1, entryTime: -1 });
visitorLogSchema.index({ agencyId: 1, entryTime: -1 });

// ── Vehicle log ───────────────────────────────────────────────────────────────
const vehicleLogSchema = new mongoose.Schema({
  agencyId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  siteId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Site',   required: true },
  loggedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'Guard',  required: true },

  plateNumber:   { type: String, required: true, trim: true, uppercase: true },
  vehicleType:   { type: String, enum: ['car', 'truck', 'motorcycle', 'van', 'other'], default: 'car' },
  vehicleColor:  String,
  driverName:    String,
  purpose:       String,

  entryTime:     { type: Date, default: Date.now },
  exitTime:      Date,
  status:        { type: String, enum: ['inside', 'exited'], default: 'inside' },
});

vehicleLogSchema.index({ siteId: 1, entryTime: -1 });

const VisitorLog = mongoose.model('VisitorLog', visitorLogSchema);
const VehicleLog = mongoose.model('VehicleLog', vehicleLogSchema);

// ── Controller ────────────────────────────────────────────────────────────────

const Guard = require('./Guard'); // resolved at runtime

async function getGuardFromReq(req) {
  const Guard = require('../models/Guard');
  return Guard.findOne({ userId: req.userId });
}

exports.VisitorLog = VisitorLog;
exports.VehicleLog = VehicleLog;

// POST /api/visitors
exports.logVisitorEntry = async (req, res) => {
  try {
    const guard = await getGuardFromReq(req);
    if (!guard) return res.status(404).json({ success: false, error: { message: 'Guard not found' } });

    const entry = await VisitorLog.create({ ...req.body, agencyId: guard.agencyId, siteId: guard.assignedSiteId, loggedBy: guard._id });
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to log visitor' } });
  }
};

// PATCH /api/visitors/:id/exit
exports.logVisitorExit = async (req, res) => {
  try {
    const log = await VisitorLog.findByIdAndUpdate(
      req.params.id,
      { exitTime: new Date(), status: 'exited' },
      { new: true }
    );
    if (!log) return res.status(404).json({ success: false, error: { message: 'Log not found' } });
    return res.json({ success: true, data: log });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to log exit' } });
  }
};

// GET /api/visitors?siteId=&date=
exports.listVisitors = async (req, res) => {
  try {
    const { siteId, date, status, page = 1, limit = 50 } = req.query;
    const filter = { agencyId: req.agencyId };
    if (siteId) filter.siteId = siteId;
    if (status) filter.status = status;
    if (date) {
      const d = new Date(date);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      filter.entryTime = { $gte: d, $lt: next };
    }

    const logs = await VisitorLog.find(filter)
      .populate('loggedBy', 'name')
      .sort({ entryTime: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    return res.json({ success: true, data: logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to list visitors' } });
  }
};

// POST /api/vehicles
exports.logVehicleEntry = async (req, res) => {
  try {
    const guard = await getGuardFromReq(req);
    if (!guard) return res.status(404).json({ success: false, error: { message: 'Guard not found' } });

    const entry = await VehicleLog.create({ ...req.body, agencyId: guard.agencyId, siteId: guard.assignedSiteId, loggedBy: guard._id });
    return res.status(201).json({ success: true, data: entry });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to log vehicle' } });
  }
};

// PATCH /api/vehicles/:id/exit
exports.logVehicleExit = async (req, res) => {
  try {
    const log = await VehicleLog.findByIdAndUpdate(
      req.params.id,
      { exitTime: new Date(), status: 'exited' },
      { new: true }
    );
    if (!log) return res.status(404).json({ success: false, error: { message: 'Log not found' } });
    return res.json({ success: true, data: log });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to log exit' } });
  }
};

// GET /api/vehicles?siteId=
exports.listVehicles = async (req, res) => {
  try {
    const { siteId, date, status, page = 1, limit = 50 } = req.query;
    const filter = { agencyId: req.agencyId };
    if (siteId) filter.siteId = siteId;
    if (status) filter.status = status;
    if (date) {
      const d = new Date(date);
      const next = new Date(d); next.setDate(d.getDate() + 1);
      filter.entryTime = { $gte: d, $lt: next };
    }

    const logs = await VehicleLog.find(filter)
      .populate('loggedBy', 'name')
      .sort({ entryTime: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    return res.json({ success: true, data: logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to list vehicles' } });
  }
};