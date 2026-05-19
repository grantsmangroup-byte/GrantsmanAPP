const express = require('express');
const {
  getAllScripApplications,
  getScripApplicationByCode,
  updateScripApplicationStatus,
  scripLoginByCode
} = require('../controllers/scripAdmin.controller');
const router = express.Router();

// Admin: Get all SCRIP applications
router.get('/applications', getAllScripApplications);

// Admin: Update SCRIP application status
router.patch('/applications/:code/status', updateScripApplicationStatus);

// Public: Get SCRIP application status by code
router.get('/status/:code', getScripApplicationByCode);

// Public: Login with reference code (if accepted)
router.post('/login', scripLoginByCode);

module.exports = router;
