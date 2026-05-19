const ScripApplication = require('../models/ScripApplication');

// Get all SCRIP applications (admin)
exports.getAllScripApplications = async (req, res) => {
  try {
    const apps = await ScripApplication.find().sort({ createdAt: -1 });
    res.json(apps);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch applications.' });
  }
};

// Get SCRIP application by reference code (public)
exports.getScripApplicationByCode = async (req, res) => {
  try {
    const app = await ScripApplication.findOne({ referenceCode: req.params.code });
    if (!app) return res.status(404).json({ error: 'Not found' });
    res.json({ status: app.status, message: app.statusMessage || '', accepted: app.accepted || false });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch application.' });
  }
};

// Update SCRIP application status (admin)
exports.updateScripApplicationStatus = async (req, res) => {
  try {
    const { status, statusMessage, accepted } = req.body;
    const app = await ScripApplication.findOneAndUpdate(
      { referenceCode: req.params.code },
      { status, statusMessage, accepted },
      { new: true }
    );
    if (!app) return res.status(404).json({ error: 'Not found' });
    res.json(app);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status.' });
  }
};

// Login with reference code (public)
exports.scripLoginByCode = async (req, res) => {
  try {
    const { code } = req.body;
    const app = await ScripApplication.findOne({ referenceCode: code });
    if (!app || !app.accepted) return res.status(401).json({ error: 'Invalid or unaccepted code.' });
    // TODO: Issue JWT or session for accepted user
    res.json({ success: true, app });
  } catch (err) {
    res.status(500).json({ error: 'Login failed.' });
  }
};
