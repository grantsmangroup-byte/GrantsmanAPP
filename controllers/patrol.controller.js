const { Checkpoint, PatrolScan } = require('../models/Patrol');
const Guard = require('../models/Guard');
const { v4: uuidv4 } = require('uuid');

// ── Admin: create checkpoint ──────────────────────────────────────────────────
exports.createCheckpoint = async (req, res) => {
  try {
    const { siteId, name, location, order, nfcTag } = req.body;
    const qrCode = uuidv4(); // unique code embedded in the printable QR label

    const cp = await Checkpoint.create({
      agencyId: req.agencyId,
      siteId,
      name,
      qrCode,
      nfcTag:   nfcTag || undefined,
      location,
      order:    order || 0,
    });

    return res.status(201).json({ success: true, data: cp });
  } catch (err) {
    console.error('createCheckpoint:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to create checkpoint' } });
  }
};

// ── Admin: list checkpoints for a site ───────────────────────────────────────
exports.listCheckpoints = async (req, res) => {
  try {
    const { siteId } = req.params;
    const checkpoints = await Checkpoint.find({ agencyId: req.agencyId, siteId, isActive: true })
      .sort('order');
    return res.json({ success: true, data: checkpoints });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to list checkpoints' } });
  }
};

// ── Guard: scan a checkpoint (QR or NFC) ─────────────────────────────────────
exports.scanCheckpoint = async (req, res) => {
  try {
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) return res.status(404).json({ success: false, error: { message: 'Guard not found' } });

    const { qrCode, nfcTag, method = 'qr', location, clientRefId } = req.body;

    // Idempotency
    if (clientRefId) {
      const existing = await PatrolScan.findOne({ clientRefId });
      if (existing) return res.json({ success: true, data: existing, duplicate: true });
    }

    // Resolve checkpoint
    const query = { agencyId: guard.agencyId, isActive: true };
    if (qrCode) query.qrCode = qrCode;
    else if (nfcTag) query.nfcTag = nfcTag;
    else return res.status(400).json({ success: false, error: { message: 'qrCode or nfcTag required' } });

    const checkpoint = await Checkpoint.findOne(query);
    if (!checkpoint) {
      return res.status(404).json({ success: false, error: { message: 'Checkpoint not found' } });
    }

    const scan = await PatrolScan.create({
      agencyId:     guard.agencyId,
      guardId:      guard._id,
      siteId:       checkpoint.siteId,
      checkpointId: checkpoint._id,
      shiftId:      guard.currentShiftId,
      method,
      location,
      clientRefId:  clientRefId || undefined,
    });

    // Push to agency dashboard
    const io = req.app.get('io');
    if (io) {
      io.to(`agency-${guard.agencyId}`).emit('patrol-scan', {
        guardName:  guard.name,
        checkpoint: checkpoint.name,
        siteId:     checkpoint.siteId,
        scannedAt:  scan.scannedAt,
      });
    }

    return res.status(201).json({
      success: true,
      data: { scan, checkpointName: checkpoint.name },
    });
  } catch (err) {
    console.error('scanCheckpoint:', err);
    if (err.code === 11000) return res.status(409).json({ success: false, error: { message: 'Duplicate scan' } });
    return res.status(500).json({ success: false, error: { message: 'Failed to record scan' } });
  }
};

// ── Admin/supervisor: patrol tour report for a shift ─────────────────────────
exports.getPatrolReport = async (req, res) => {
  try {
    const { siteId, guardId, from, to } = req.query;
    const filter = { agencyId: req.agencyId };
    if (siteId)  filter.siteId  = siteId;
    if (guardId) filter.guardId = guardId;
    if (from || to) {
      filter.scannedAt = {};
      if (from) filter.scannedAt.$gte = new Date(from);
      if (to)   filter.scannedAt.$lte = new Date(to);
    }

    const scans = await PatrolScan.find(filter)
      .populate('guardId', 'name')
      .populate('checkpointId', 'name order location')
      .sort({ scannedAt: 1 });

    return res.json({ success: true, data: { scans } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to load patrol report' } });
  }
};