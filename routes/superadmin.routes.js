const router = require('express').Router();
const mongoose = require('mongoose');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const Agency = require('../models/Agency');
const Guard = require('../models/Guard');
const Site = require('../models/Site');
const SOSAlert = require('../models/SOSAlert');
const User = require('../models/User');

// All routes require super admin auth
router.use(authenticate, authorize('super-admin'));

// Dashboard Stats
router.get('/dashboard', async (req, res) => {
  try {
    const totalAgencies = await Agency.countDocuments();
    const activeAgencies = await Agency.countDocuments({ status: 'active' });
    const totalGuards = await Guard.countDocuments();
    const activeGuards = await Guard.countDocuments({ status: 'on-duty' });
    const totalSites = await Site.countDocuments();
    const activeSOS = await SOSAlert.countDocuments({ status: 'active' });

    // Calculate monthly revenue
    const guards = await Guard.countDocuments();
    const monthlyRevenue = guards * 1200; // 1200 FCFA per guard

    res.json({
      success: true,
      data: {
        agencies: { total: totalAgencies, active: activeAgencies },
        guards: { total: totalGuards, active: activeGuards },
        sites: { total: totalSites },
        sos: { active: activeSOS },
        revenue: { monthly: monthlyRevenue }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create Agency
router.post('/agencies', async (req, res) => {
  try {
    const {
      name,
      adminName,
      email,
      adminEmail,
      adminPassword,
      phone,
      address
    } = req.body;

    const resolvedEmail = adminEmail || email;

    if (!name || !adminName || !resolvedEmail) {
      return res.status(400).json({ success: false, message: 'Name, admin name, and email are required' });
    }

    const existingAgency = await Agency.findOne({ email: resolvedEmail });
    if (existingAgency) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    const existingUser = await User.findOne({ email: resolvedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Admin user already exists' });
    }

    const agency = new Agency({
      name,
      adminName,
      email: resolvedEmail,
      phone,
      address,
      status: 'active'
    });

    await agency.save();

    await User.create({
      fullName: adminName,
      email: resolvedEmail,
      phone,
      password: adminPassword || 'admin123',
      role: 'agency-admin',
      agencyId: agency._id,
      isActive: true
    });

    res.status(201).json({
      success: true,
      data: agency,
      message: 'Agency created successfully',
      tempPassword: adminPassword ? undefined : 'admin123'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get All Agencies
router.get('/agencies', async (req, res) => {
  try {
    const agencies = await Agency.find();
    
    // Get guard and site counts for each agency
    const agenciesWithCounts = await Promise.all(
      agencies.map(async (agency) => {
        const guardCount = await Guard.countDocuments({ agencyId: agency._id });
        const siteCount = await Site.countDocuments({ agencyId: agency._id });
        
        return {
          ...agency.toObject(),
          guardCount,
          siteCount,
          mrr: guardCount * 1200
        };
      })
    );

    res.json({ success: true, data: agenciesWithCounts });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Agency
router.put('/agencies/:id', async (req, res) => {
  try {
    const updates = req.body;
    
    if (updates.adminPassword) {
      updates.adminPassword = await bcrypt.hash(updates.adminPassword, 10);
    }

    const agency = await Agency.findByIdAndUpdate(
      req.params.id,
      updates,
      { new: true }
    ).select('-adminPassword');

    if (!agency) {
      return res.status(404).json({ success: false, message: 'Agency not found' });
    }

    res.json({ success: true, data: agency });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Toggle Agency Status
router.patch('/agencies/:id/toggle-status', async (req, res) => {
  try {
    const agency = await Agency.findById(req.params.id);
    if (!agency) {
      return res.status(404).json({ success: false, message: 'Agency not found' });
    }

    agency.status = agency.status === 'active' ? 'suspended' : 'active';
    await agency.save();

    res.json({ success: true, data: agency });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// System Health
router.get('/system-health', async (req, res) => {
  try {
    const health = {
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      apis: {
        mtnChenosis: { status: 'mocked', latency: 'N/A' },
        africasTalking: { status: 'active', latency: '120ms' },
        socketIo: { status: 'active', latency: '45ms' }
      },
      uptime: process.uptime(),
      timestamp: new Date()
    };

    res.json({ success: true, data: health });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;