const ScripApplication = require('../models/ScripApplication');

// ── Reference code generator ──────────────────────────────────────────────────
function generateReferenceCode(lastName) {
  const prefix = (lastName || 'GSM').substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
  const rand   = Math.random().toString(36).substring(2, 8).toUpperCase();
  const yr     = new Date().getFullYear();
  return `${prefix}-SCRIP-${yr}-${rand}`;
}

// ── Ensure uniqueness (retry up to 5 times) ───────────────────────────────────
async function uniqueCode(lastName) {
  for (let i = 0; i < 5; i++) {
    const code = generateReferenceCode(lastName);
    const exists = await ScripApplication.findOne({ referenceCode: code });
    if (!exists) return code;
  }
  throw new Error('Could not generate unique reference code');
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scrip/apply
// Public — submit a new SCRIP application
// ─────────────────────────────────────────────────────────────────────────────
// exports.submitApplication = async (req, res) => {
//   try {
//     const { identity, legal, employment, education } = req.body;

//     // ── Basic presence check ─────────────────────────────────────────────────
//     if (!identity || !legal || !employment || !education) {
//       return res.status(400).json({
//         success: false,
//         error: { message: 'Incomplete application data', code: 'VALIDATION_ERROR' },
//       });
//     }

exports.submitApplication = async (req, res) => {
  try {
    // If sent as multipart FormData, sections arrive as JSON strings — parse them
    ['identity', 'legal', 'employment', 'education'].forEach((key) => {
      if (typeof req.body[key] === 'string') {
        try { req.body[key] = JSON.parse(req.body[key]); } catch {}
      }
    });

    const { identity, legal, employment, education } = req.body;

    // ── Duplicate guard — same email or phone can't re-apply if not rejected ──
    const duplicate = await ScripApplication.findOne({
      $or: [
        { 'identity.email': identity.email?.toLowerCase() },
        { 'identity.phone': identity.phone },
      ],
      status: { $ne: 'rejected' },
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        error: {
          message: 'An active application already exists for this email or phone number.',
          code: 'DUPLICATE_APPLICATION',
          referenceCode: duplicate.referenceCode,
        },
      });
    }

    // ── Generate unique reference code ───────────────────────────────────────
    const referenceCode = await uniqueCode(identity.lastName);

    // ── Attach photo filename if uploaded via multer ──────────────────────────
    if (req.file) {
      identity.photoFileName = req.file.filename;
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const application = new ScripApplication({
      identity,
      legal,
      employment,
      education,
      referenceCode,
    });

    await application.save();

    return res.status(201).json({
      success: true,
      data: {
        referenceCode: application.referenceCode,
        status: application.status,
        submittedAt: application.submittedAt,
        message: 'Your SCRIP application has been received. Our team will be in touch within 5–7 business days.',
      },
    });
  } catch (err) {
    console.error('[SCRIP] submitApplication error:', err);

    // Mongoose validation errors
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        error: { message: messages.join('. '), code: 'VALIDATION_ERROR' },
      });
    }

    // Duplicate key (race condition on referenceCode / email)
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: { message: 'A duplicate entry was detected. Please try again.', code: 'DUPLICATE_KEY' },
      });
    }

    return res.status(500).json({
      success: false,
      error: { message: 'Server error. Please try again later.', code: 'SERVER_ERROR' },
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scrip/status/:referenceCode
// Public — look up application status by reference code
// ─────────────────────────────────────────────────────────────────────────────
exports.getStatus = async (req, res) => {
  try {
    const { referenceCode } = req.params;

    const application = await ScripApplication.findOne({
      referenceCode: referenceCode.toUpperCase(),
    }).select('referenceCode status submittedAt updatedAt identity.firstName identity.lastName identity.programArea');

    if (!application) {
      return res.status(404).json({
        success: false,
        error: { message: 'Application not found. Please check your reference code.', code: 'NOT_FOUND' },
      });
    }

    return res.json({
      success: true,
      data: {
        referenceCode: application.referenceCode,
        applicantName: application.fullName,
        programArea:   application.identity.programArea,
        status:        application.status,
        submittedAt:   application.submittedAt,
        updatedAt:     application.updatedAt,
      },
    });
  } catch (err) {
    console.error('[SCRIP] getStatus error:', err);
    return res.status(500).json({
      success: false,
      error: { message: 'Server error', code: 'SERVER_ERROR' },
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scrip/applications  (admin — requires authenticate + authorize)
// List all applications with optional filters
// ─────────────────────────────────────────────────────────────────────────────
exports.listApplications = async (req, res) => {
  try {
    const {
      status,
      programArea,
      page  = 1,
      limit = 20,
      sort  = '-submittedAt',
    } = req.query;

    const filter = {};
    if (status)      filter.status = status;
    if (programArea) filter['identity.programArea'] = programArea;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await ScripApplication.countDocuments(filter);

    const applications = await ScripApplication.find(filter)
      .select('referenceCode status submittedAt identity.firstName identity.lastName identity.email identity.phone identity.programArea')
      .sort(sort)
      .skip(skip)
      .limit(Number(limit));

    return res.json({
      success: true,
      data: {
        applications,
        pagination: {
          total,
          page:       Number(page),
          limit:      Number(limit),
          totalPages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (err) {
    console.error('[SCRIP] listApplications error:', err);
    return res.status(500).json({
      success: false,
      error: { message: 'Server error', code: 'SERVER_ERROR' },
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scrip/applications/:id  (admin)
// Get a single application in full
// ─────────────────────────────────────────────────────────────────────────────
exports.getApplication = async (req, res) => {
  try {
    const application = await ScripApplication.findById(req.params.id);

    if (!application) {
      return res.status(404).json({
        success: false,
        error: { message: 'Application not found', code: 'NOT_FOUND' },
      });
    }

    return res.json({ success: true, data: application });
  } catch (err) {
    console.error('[SCRIP] getApplication error:', err);
    return res.status(500).json({
      success: false,
      error: { message: 'Server error', code: 'SERVER_ERROR' },
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/scrip/applications/:id/status  (admin)
// Update application status + optional review notes
// ─────────────────────────────────────────────────────────────────────────────
exports.updateStatus = async (req, res) => {
  try {
    const { status, reviewNotes } = req.body;

    const validStatuses = ['submitted', 'under_review', 'confirmed', 'enrolled', 'completed', 'recommended', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: { message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`, code: 'VALIDATION_ERROR' },
      });
    }

    const application = await ScripApplication.findByIdAndUpdate(
      req.params.id,
      { status, reviewNotes, updatedAt: new Date() },
      { new: true, runValidators: true }
    ).select('referenceCode status reviewNotes updatedAt identity.firstName identity.lastName');

    if (!application) {
      return res.status(404).json({
        success: false,
        error: { message: 'Application not found', code: 'NOT_FOUND' },
      });
    }

    return res.json({
      success: true,
      data: application,
      message: `Application status updated to "${status}"`,
    });
  } catch (err) {
    console.error('[SCRIP] updateStatus error:', err);
    return res.status(500).json({
      success: false,
      error: { message: 'Server error', code: 'SERVER_ERROR' },
    });
  }
};
