const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const guardController = require('../controllers/guard.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// Custom validation for location (supports both formats)
const validateLocation = (req, res, next) => {
  const errors = validationResult(req);
  const { latitude, longitude } = req.body;
  const { latitude: locLat, longitude: locLon } = req.body.location || {};
  
  if (!errors.isEmpty() || (!latitude && !locLat) || (!longitude && !locLon)) {
    return res.status(400).json({ 
      success: false, 
      error: { 
        message: 'Valid location coordinates required (latitude and longitude)', 
        code: 'INVALID_LOCATION' 
      }
    });
  }
  next();
};

// All routes require authentication and guard role
router.use(authenticate);
router.use(authorize('guard'));

// Get dashboard data
router.get('/dashboard', guardController.getDashboard);

// Clock in
router.post('/clock-in',
  [
    body('latitude').optional().isFloat().withMessage('Valid latitude required'),
    body('longitude').optional().isFloat().withMessage('Valid longitude required'),
    body('location.latitude').optional().isFloat().withMessage('Valid latitude required'),
    body('location.longitude').optional().isFloat().withMessage('Valid longitude required'),
  ],
  validateLocation,
  guardController.clockIn
);

// Clock out
router.post('/clock-out',
  [
    body('latitude').optional().isFloat().withMessage('Valid latitude required'),
    body('longitude').optional().isFloat().withMessage('Valid longitude required'),
    body('location.latitude').optional().isFloat().withMessage('Valid latitude required'),
    body('location.longitude').optional().isFloat().withMessage('Valid longitude required'),
  ],
  validateLocation,
  guardController.clockOut
);

// Get shift status
router.get('/shift-status', guardController.getShiftStatus);

// Get welfare check history
router.get('/check-history', guardController.getCheckHistory);

module.exports = router;