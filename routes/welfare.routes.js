const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const welfareController = require('../controllers/welfare.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// Twilio webhooks (public)
router.post('/twilio/voice', welfareController.twilioVoiceWebhook);
router.post('/twilio/verify', welfareController.twilioVerifyResponse);
router.post('/twilio/status', welfareController.twilioStatusWebhook);

// All non-Twilio routes require authentication
router.use(authenticate);

// Respond to welfare call (guard only)
router.post('/response',
  authorize('guard'),
  [
    body('callId').notEmpty().withMessage('Call ID required'),
    body('location.latitude').optional().isFloat().withMessage('Valid latitude required'),
    body('location.longitude').optional().isFloat().withMessage('Valid longitude required'),
    validate
  ],
  welfareController.respondToCall
);

// Get pending checks (guard only)
router.get('/pending',
  authorize('guard'),
  welfareController.getPendingChecks
);

// Confirm alertness manually (guard only)
router.post('/confirm',
  authorize('guard'),
  [
    body('latitude').isFloat().withMessage('Valid latitude required'),
    body('longitude').isFloat().withMessage('Valid longitude required'),
    validate
  ],
  welfareController.confirmAlertness
);

module.exports = router;
