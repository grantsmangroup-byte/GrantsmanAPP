const Incident = require('../models/Incident');
const Guard    = require('../models/Guard');
const Site     = require('../models/Site');

// ── helpers ───────────────────────────────────────────────────────────────────
const agencyScope = (req) => ({ agencyId: req.agencyId });

// ── POST /api/incidents  (guard creates) ─────────────────────────────────────
exports.createIncident = async (req, res) => {
  try {
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) return res.status(404).json({ success: false, error: { message: 'Guard not found' } });

    const {
      category, severity, title, description,
      location, occurredAt, clientRefId,
    } = req.body;

    // Idempotency: if the same clientRefId arrives twice (offline retry), return existing
    if (clientRefId) {
      const existing = await Incident.findOne({ clientRefId });
      if (existing) {
        return res.status(200).json({ success: true, data: existing, duplicate: true });
      }
    }

    // Build attachments from multer uploads if any
    const attachments = (req.files || []).map((f) => ({
      url:      f.path || f.location || `/uploads/${f.filename}`,
      mimeType: f.mimetype,
    }));

    const incident = await Incident.create({
      agencyId:    guard.agencyId,
      guardId:     guard._id,
      siteId:      guard.assignedSiteId,
      shiftId:     guard.currentShiftId,
      reportedBy:  req.userId,
      category,
      severity:    severity || 'medium',
      title,
      description,
      location,
      occurredAt:  occurredAt || new Date(),
      attachments,
      clientRefId: clientRefId || undefined,
    });

    // Real-time push to agency dashboard
    const io = req.app.get('io');
    if (io) {
      io.to(`agency-${guard.agencyId}`).emit('new-incident', {
        incidentId: incident._id,
        severity:   incident.severity,
        category:   incident.category,
        title:      incident.title,
        guardName:  guard.name,
      });
    }

    return res.status(201).json({ success: true, data: incident });
  } catch (err) {
    console.error('createIncident:', err);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, error: { message: 'Duplicate incident', code: 'DUPLICATE' } });
    }
    return res.status(500).json({ success: false, error: { message: 'Failed to create incident' } });
  }
};

// ── GET /api/incidents  (agency admin / supervisor) ──────────────────────────
exports.listIncidents = async (req, res) => {
  try {
    const {
      page = 1, limit = 20, status, severity, category,
      siteId, guardId, from, to,
    } = req.query;

    const filter = { ...agencyScope(req) };
    if (status)   filter.status   = status;
    if (severity) filter.severity = severity;
    if (category) filter.category = category;
    if (siteId)   filter.siteId   = siteId;
    if (guardId)  filter.guardId  = guardId;
    if (from || to) {
      filter.reportedAt = {};
      if (from) filter.reportedAt.$gte = new Date(from);
      if (to)   filter.reportedAt.$lte = new Date(to);
    }

    const [incidents, total] = await Promise.all([
      Incident.find(filter)
        .populate('guardId', 'name phone')
        .populate('siteId', 'name address')
        .populate('reportedBy', 'fullName')
        .sort({ reportedAt: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit)),
      Incident.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      data: {
        incidents,
        pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
      },
    });
  } catch (err) {
    console.error('listIncidents:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to list incidents' } });
  }
};

// ── GET /api/incidents/:id ────────────────────────────────────────────────────
exports.getIncident = async (req, res) => {
  try {
    const incident = await Incident.findOne({ _id: req.params.id, ...agencyScope(req) })
      .populate('guardId', 'name phone device')
      .populate('siteId', 'name address latitude longitude')
      .populate('reportedBy', 'fullName')
      .populate('resolution.resolvedBy', 'fullName');

    if (!incident) return res.status(404).json({ success: false, error: { message: 'Incident not found' } });
    return res.json({ success: true, data: incident });
  } catch (err) {
    console.error('getIncident:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch incident' } });
  }
};

// ── PATCH /api/incidents/:id/resolve  (supervisor / admin) ───────────────────
exports.resolveIncident = async (req, res) => {
  try {
    const { notes, status = 'resolved' } = req.body;
    const allowedStatuses = ['under_review', 'resolved', 'closed'];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid status' } });
    }

    const incident = await Incident.findOneAndUpdate(
      { _id: req.params.id, ...agencyScope(req) },
      {
        status,
        resolution: { notes, resolvedBy: req.userId, resolvedAt: new Date() },
      },
      { new: true }
    );

    if (!incident) return res.status(404).json({ success: false, error: { message: 'Incident not found' } });

    return res.json({ success: true, data: incident });
  } catch (err) {
    console.error('resolveIncident:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to resolve incident' } });
  }
};

// ── PATCH /api/incidents/:id/visibility  (toggle client visibility) ──────────
exports.setClientVisibility = async (req, res) => {
  try {
    const { clientVisible } = req.body;
    const incident = await Incident.findOneAndUpdate(
      { _id: req.params.id, ...agencyScope(req) },
      { clientVisible },
      { new: true }
    );
    if (!incident) return res.status(404).json({ success: false, error: { message: 'Incident not found' } });
    return res.json({ success: true, data: { clientVisible: incident.clientVisible } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to update visibility' } });
  }
};

// ── GET /api/guard/incidents  (guard views own incidents) ─────────────────────
exports.getGuardIncidents = async (req, res) => {
  try {
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) return res.status(404).json({ success: false, error: { message: 'Guard not found' } });

    const { page = 1, limit = 20 } = req.query;
    const filter = { guardId: guard._id };

    const [incidents, total] = await Promise.all([
      Incident.find(filter)
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