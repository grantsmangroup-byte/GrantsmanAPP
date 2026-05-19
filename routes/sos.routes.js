const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const sosController = require('../controllers/sos.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// Trigger SOS (guard only)
router.post('/trigger',
  authorize('guard'),
  [
    body('latitude').isFloat().withMessage('Valid latitude required'),
    body('longitude').isFloat().withMessage('Valid longitude required'),
    body('timestamp').optional().isISO8601().withMessage('Valid timestamp required'),
    validate
  ],
  sosController.triggerSOS
);

// Cancel SOS (guard only)
router.post('/:alertId/cancel',
  authorize('guard'),
  sosController.cancelSOS
);

// Get alerts (agency-admin, super-admin)
router.get('/alerts',
  authorize('agency-admin', 'super-admin'),
  sosController.getAlerts
);

// Resolve alert (agency-admin, super-admin)
router.put('/:id/resolve',
  authorize('agency-admin', 'super-admin'),
  sosController.resolveAlert
);

module.exports = router;