const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');

const {
  createIncident,
  listIncidents,
  getIncident,
  resolveIncident,
  setClientVisibility,
  getGuardIncidents,
} = require('../controllers/incident.controller');

const { authenticate, authorize } = require('../middleware/auth');

// Local disk storage for attachments (swap for S3/Cloudinary in prod)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/incidents/'),
  filename:    (req, file, cb) =>
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Guard routes ─────────────────────────────────────────────────────────────
// Guard submits a new incident (up to 5 attachments)
router.post(
  '/',
  authenticate,
  authorize('guard'),
  upload.array('attachments', 5),
  createIncident
);

// Guard views own incident history
router.get('/mine', authenticate, authorize('guard'), getGuardIncidents);

// ── Agency admin / supervisor routes ─────────────────────────────────────────
router.get(
  '/',
  authenticate,
  authorize('agency-admin', 'supervisor'),
  listIncidents
);

router.get(
  '/:id',
  authenticate,
  authorize('agency-admin', 'supervisor'),
  getIncident
);

router.patch(
  '/:id/resolve',
  authenticate,
  authorize('agency-admin', 'supervisor'),
  resolveIncident
);

router.patch(
  '/:id/visibility',
  authenticate,
  authorize('agency-admin'),
  setClientVisibility
);

module.exports = router;