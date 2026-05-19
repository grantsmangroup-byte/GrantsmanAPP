const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// Guard login
// router.post('/guard/login',
//   [
//     body('phone').notEmpty().withMessage('Phone number is required'),
//     body('password').notEmpty().withMessage('Password is required'),
//     validate
//   ],
//   authController.guardLogin
// );

router.post('/guard-login',
  [
    body('phone').notEmpty().withMessage('Phone number is required'),
    body('password').notEmpty().withMessage('Password is required'),
    validate
  ],
  authController.guardLogin
);

// Web login (email + password)
router.post('/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    validate
  ],
  authController.login
);

// Get current user profile
router.get('/me', authenticate, authController.getProfile);

// Logout
router.post('/logout', authController.logout);

module.exports = router;