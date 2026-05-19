const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');

const scripController = require('../controllers/scrip.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/scrip/apply
 * Submit a new SCRIP due diligence application.
 * No authentication required — public form submission.
 */



// ── Middleware: when request is multipart/form-data, the frontend sends
// identity/legal/employment/education as JSON strings. Parse them onto
// req.body so express-validator can read them normally.
function parseFormDataJson(req, res, next) {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    ['identity', 'legal', 'employment', 'education'].forEach((key) => {
      if (typeof req.body[key] === 'string') {
        try {
          req.body[key] = JSON.parse(req.body[key]);
        } catch {
          // leave as-is; validator will catch the error
        }
      }
    });
  }
  next();
}

router.post(
  '/apply',
  parseFormDataJson,   // ← add this before validators
  [
    body('identity.firstName').notEmpty().withMessage('First name is required').trim(),
    body('identity.lastName').notEmpty().withMessage('Last name is required').trim(),
    body('identity.dob').notEmpty().withMessage('Date of birth is required'),
    body('identity.gender').notEmpty().withMessage('Gender is required'),
    body('identity.nationality').notEmpty().withMessage('Nationality is required').trim(),
    body('identity.idNumber').notEmpty().withMessage('ID/Passport number is required').trim(),
    body('identity.email').isEmail().withMessage('A valid email is required').normalizeEmail(),
    body('identity.phone').notEmpty().withMessage('Phone number is required').trim(),
    body('identity.programArea')
      .isIn(['Finance', 'Security', 'IT', 'Health', 'Logistics'])
      .withMessage('Invalid program area'),
    body('legal.criminalRecord')
      .isIn(['Yes', 'No'])
      .withMessage('Please indicate criminal record status'),
    body('legal.country').notEmpty().withMessage('Country is required').trim(),
    body('legal.region').notEmpty().withMessage('Region is required').trim(),
    body('legal.city').notEmpty().withMessage('City is required').trim(),
    body('legal.address').notEmpty().withMessage('Address is required').trim(),
    body('legal.isIdp').isIn(['Yes', 'No']).withMessage('Please indicate IDP status'),
    validate,
  ],
  scripController.submitApplication
);



// router.post(
//   '/apply',
//   [
//     // Identity
//     body('identity.firstName').notEmpty().withMessage('First name is required').trim(),
//     body('identity.lastName').notEmpty().withMessage('Last name is required').trim(),
//     body('identity.dob').notEmpty().withMessage('Date of birth is required'),
//     body('identity.gender').notEmpty().withMessage('Gender is required'),
//     body('identity.nationality').notEmpty().withMessage('Nationality is required').trim(),
//     body('identity.idNumber').notEmpty().withMessage('ID/Passport number is required').trim(),
//     body('identity.email').isEmail().withMessage('A valid email is required').normalizeEmail(),
//     body('identity.phone').notEmpty().withMessage('Phone number is required').trim(),
//     body('identity.programArea')
//       .isIn(['Finance', 'Security', 'IT', 'Health', 'Logistics'])
//       .withMessage('Invalid program area'),

//     // Legal
//     body('legal.criminalRecord')
//       .isIn(['Yes', 'No'])
//       .withMessage('Please indicate criminal record status'),
//     body('legal.country').notEmpty().withMessage('Country is required').trim(),
//     body('legal.region').notEmpty().withMessage('Region is required').trim(),
//     body('legal.city').notEmpty().withMessage('City is required').trim(),
//     body('legal.address').notEmpty().withMessage('Address is required').trim(),
//     body('legal.isIdp').isIn(['Yes', 'No']).withMessage('Please indicate IDP status'),

//     validate,
//   ],
//   scripController.submitApplication
// );

/**
 * GET /api/scrip/status/:referenceCode
 * Public status lookup by reference code.
 */
router.get(
  '/status/:referenceCode',
  [
    param('referenceCode')
      .notEmpty()
      .withMessage('Reference code is required')
      .isLength({ min: 15, max: 30 })
      .withMessage('Invalid reference code format'),
    validate,
  ],
  scripController.getStatus
);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ROUTES — require authentication + admin role
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/scrip/applications
 * List all applications (paginated). Admin only.
 * Query params: ?status=submitted&programArea=Security&page=1&limit=20&sort=-submittedAt
 */
router.get(
  '/applications',
  authenticate,
  authorize('super-admin', 'agency-admin'),
  scripController.listApplications
);

/**
 * GET /api/scrip/applications/:id
 * Get a single full application. Admin only.
 */
router.get(
  '/applications/:id',
  authenticate,
  authorize('super-admin', 'agency-admin'),
  scripController.getApplication
);

/**
 * PATCH /api/scrip/applications/:id/status
 * Update application status. Admin only.
 * Body: { status: 'confirmed', reviewNotes: '...' }
 */
router.patch(
  '/applications/:id/status',
  authenticate,
  authorize('super-admin', 'agency-admin'),
  [
    body('status')
      .isIn(['submitted', 'under_review', 'confirmed', 'enrolled', 'completed', 'recommended', 'rejected'])
      .withMessage('Invalid status value'),
    validate,
  ],
  scripController.updateStatus
);

module.exports = router;
