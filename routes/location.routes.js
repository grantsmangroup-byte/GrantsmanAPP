const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const locationController = require('../controllers/location.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// All routes require authentication
router.use(authenticate);

// Send location ping (guard only)
router.post('/ping',
  authorize('guard'),
  [
    body('latitude').isFloat().withMessage('Valid latitude required'),
    body('longitude').isFloat().withMessage('Valid longitude required'),
    body('timestamp').optional().isISO8601().withMessage('Valid timestamp required'),
    body('accuracy').optional().isFloat().withMessage('Valid accuracy required'),
    validate
  ],
  locationController.sendLocationPing
);

// Validate geofence (guard only)
router.post('/validate-geofence',
  authorize('guard'),
  [
    body('latitude').isFloat().withMessage('Valid latitude required'),
    body('longitude').isFloat().withMessage('Valid longitude required'),
    validate
  ],
  locationController.validateGeofence
);

module.exports = router;