const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Maintenance = require('../models/Maintenance');
const ACUnit = require('../models/ACUnit');
const PowerSystem = require('../models/PowerSystem');
const Tower = require('../models/Tower');
const Site = require('../models/Site');
const Generator = require('../models/Generator');
const Cluster = require('../models/Cluster');
const sendEmail = require('../utils/sendEmail');
const sendSMS = require('../utils/smsService');
const logger = require('../utils/logger');

// ==================== HELPER FUNCTIONS ====================

const validateObjectId = (id, fieldName) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`Invalid ${fieldName} ID format`);
  }
};

const validateGeneratorId = (id) => {
  if (!/^GEN[A-Z]{3}\d{3}$/.test(id)) {
    throw new Error('Invalid generator ID format. Expected format: GEN_XXX_000');
  }
};

const validateTowerId = (id) => {
  if (!/^TOWER[A-Z]{3}\d{3}$/.test(id)) {
    throw new Error('Invalid tower ID format. Expected format: TOWER_XXX_000');
  }
};

const validateAndProcessParts = (parts) => {
  if (!parts || !Array.isArray(parts)) return [];

  return parts.map(part => {
    if (!part.part || !mongoose.Types.ObjectId.isValid(part.part)) {
      throw new Error('Invalid part ID in partsToReplace');
    }
    if (!part.quantity || isNaN(part.quantity) || part.quantity < 1) {
      throw new Error('Invalid quantity for part');
    }
    return {
      part: new mongoose.Types.ObjectId(part.part),
      name: part.name || '',
      quantity: parseInt(part.quantity)
    };
  });
};

const validateAndParseDate = (dateString, fieldName = 'date') => {
  if (!dateString) {
    throw new Error(`${fieldName} is required`);
  }

  let parsedDate;

  if (typeof dateString === 'string') {
    parsedDate = new Date(dateString);
  } else if (dateString instanceof Date) {
    parsedDate = dateString;
  } else {
    throw new Error(`Invalid ${fieldName} format`);
  }

  if (isNaN(parsedDate.getTime())) {
    throw new Error(`Invalid ${fieldName} format`);
  }

  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60000);

  if (parsedDate < oneMinuteAgo) {
    throw new Error(`${fieldName} must be in the future`);
  }

  return parsedDate;
};

const createEquipment = async (Model, req, res) => {
  try {
    const { id, tower_id, model, status, installation_date, ...specs } = req.body;

    const equipment = new Model({
      _id: id,
      tower_id,
      model,
      status,
      installation_date: new Date(installation_date),
      specifications: specs,
      tower: tower_id
    });

    await equipment.save();

    res.status(201).json({
      success: true,
      data: equipment
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

// ==================== AUTHENTICATION ====================

exports.register = async (req, res) => {
  try {
    const { email, phone, password, fullName, role } = req.body;

    if (!email && !phone) {
      return res.status(400).json({
        success: false,
        message: 'Either email or phone is required'
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    if (role && !['user', 'doer', 'technician', 'supervisor', 'analyst', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role specified'
      });
    }

    let query = email ? { email } : { phone };
    const existingUser = await User.findOne(query);

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    const emailVerificationToken = email ?
      Math.floor(100000 + Math.random() * 900000).toString() : undefined;
    const phoneVerificationToken = phone ?
      Math.floor(100000 + Math.random() * 900000).toString() : undefined;

    const user = new User({
      email,
      phone,
      password,
      fullName,
      role: role || 'user',
      userType: role || 'user',
      emailVerificationToken,
      phoneVerificationToken,
      status: 'unverified',
      isActive: true
    });

    await user.save();

    const token = jwt.sign(
      { userId: user._id, userType: user.userType },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    if (email && emailVerificationToken) {
      try {
        await sendEmail({
          to: email,
          subject: 'Verify your account',
          text: `Your verification code is: ${emailVerificationToken}`,
          html: `
            <div style="text-align: center; font-family: Arial, sans-serif;">
              <h2>Welcome!</h2>
              <p>Please verify your email address using the following code:</p>
              <h1 style="color: #4CAF50;">${emailVerificationToken}</h1>
              <p>This code will expire in 24 hours.</p>
            </div>
          `
        });
      } catch (emailError) {
        logger.error('Failed to send verification email:', emailError);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          phone: user.phone,
          fullName: user.fullName,
          role: user.role,
          userType: user.userType
        }
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const user = await User.findOne({ email })
      .select('+password +isActive +loginAttempts +lockUntil +userType +role');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    const actualUserType = user.userType || user.role;

    if (!actualUserType) {
      logger.error('User has no userType or role:', user._id);
      return res.status(500).json({
        success: false,
        message: 'User account is not properly configured. Please contact administrator.'
      });
    }

    if (user.isLocked) {
      const remainingTime = Math.ceil((user.lockUntil - Date.now()) / 1000 / 60);
      return res.status(403).json({
        success: false,
        message: `Account temporarily locked. Try again in ${remainingTime} minutes.`
      });
    }

    let isMatch;
    try {
      isMatch = await user.comparePassword(password);
    } catch (compareError) {
      isMatch = await bcrypt.compare(password, user.password);
    }

    if (!isMatch) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;

      if (user.loginAttempts >= 5) {
        user.isLocked = true;
        user.lockUntil = Date.now() + 30 * 60 * 1000;
      }

      await user.save();

      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
        attemptsLeft: Math.max(0, 5 - user.loginAttempts)
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account is not active. Please contact your administrator.'
      });
    }

    user.loginAttempts = 0;
    user.isLocked = false;
    user.lockUntil = undefined;

    if (!user.userType && user.role) {
      user.userType = user.role;
    }

    await user.save();

    const tokenPayload = {
      userId: user._id,
      userType: actualUserType,
      email: user.email
    };

    const accessToken = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      tokenPayload,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    user.refreshToken = refreshToken;
    await user.save();

    logger.info('Login successful', { userId: user._id, userType: actualUserType });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          _id: user._id,
          email: user.email,
          fullName: user.fullName,
          userType: actualUserType,
          role: actualUserType,
          isActive: user.isActive,
          profileImage: user.profileImage
        }
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.refreshToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token required'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(
        refreshToken,
        process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
      );
    } catch (verifyError) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }

    const user = await User.findById(decoded.userId);

    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({
        success: false,
        error: 'Invalid refresh token'
      });
    }

    const tokenPayload = {
      userId: user._id,
      userType: user.userType || user.role,
      email: user.email
    };

    const newAccessToken = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const newRefreshToken = jwt.sign(
      tokenPayload,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    user.refreshToken = newRefreshToken;
    await user.save();

    res.status(200).json({
      success: true,
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }
    });

  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

exports.logout = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    if (refreshToken) {
      await User.findOneAndUpdate(
        { refreshToken },
        { $unset: { refreshToken: 1 } }
      );
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: error.message
    });
  }
};

// ==================== USER MANAGEMENT ====================

exports.getUsers = async (req, res) => {
  try {
    const { role, userType, isActive, page = 1, limit = 50 } = req.query;

    const query = {};

    if (role || userType) {
      query.role = role || userType;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const skip = (page - 1) * limit;

    const users = await User.find(query)
      .populate('supervised_clusters', 'name code region')
      .populate('assigned_cluster', 'name code region')
      .select('-password -refreshToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        users: users,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / limit),
          limit: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error.message
    });
  }
};

// ==================== TECHNICIAN MANAGEMENT ====================

exports.createTechnician = async (req, res) => {
  try {
    const { email, phone, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and full name are required'
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    const technician = await User.create({
      email,
      phone,
      password,
      fullName,
      role: 'technician',
      userType: 'technician',
      isActive: true
    });

    res.status(201).json({
      success: true,
      message: 'Technician created successfully',
      data: {
        id: technician._id,
        email: technician.email,
        phone: technician.phone,
        fullName: technician.fullName,
        isActive: technician.isActive
      }
    });

  } catch (error) {
    logger.error('Create technician error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create technician account',
      error: error.message
    });
  }
};

exports.activateTechnician = async (req, res) => {
  try {
    const { technicianId } = req.params;

    if (req.user.userType !== 'admin' && req.user.userType !== 'supervisor') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators and supervisors can perform this action'
      });
    }

    const technician = await User.findById(technicianId);

    if (!technician || (technician.userType !== 'technician' && technician.role !== 'technician')) {
      return res.status(404).json({
        success: false,
        message: 'Technician not found'
      });
    }

    technician.isActive = true;
    await technician.save();

    res.status(200).json({
      success: true,
      message: 'Technician account activated successfully'
    });

  } catch (error) {
    logger.error('Activation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to activate technician',
      error: error.message
    });
  }
};

exports.getTechnicianMaintenance = async (req, res) => {
  try {
    const { technicianId } = req.params;

    if (req.user.userId !== technicianId && !['admin', 'supervisor'].includes(req.user.userType)) {
      return res.status(403).json({
        success: false,
        message: 'You can only view your own maintenance tasks'
      });
    }

    const maintenance = await Maintenance.find({
      technician: technicianId,
      status: { $in: ['scheduled', 'in_progress', 'pending'] }
    })
      .populate('tower', 'name location')
      .populate('equipment')
      .populate('supervisor', 'fullName email phone')
      .populate('partsToReplace.part', 'name part_number')
      .sort({ scheduledDate: 1 });

    const completedThisWeek = await Maintenance.countDocuments({
      technician: technicianId,
      status: 'completed',
      completedDate: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      }
    });

    res.status(200).json({
      success: true,
      data: maintenance,
      stats: {
        total: maintenance.length,
        pending: maintenance.filter(m => m.status === 'pending').length,
        in_progress: maintenance.filter(m => m.status === 'in_progress').length,
        scheduled: maintenance.filter(m => m.status === 'scheduled').length,
        completedThisWeek
      }
    });

  } catch (error) {
    logger.error('Get technician maintenance error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get maintenance tasks',
      error: error.message
    });
  }
};

// ==================== SUPERVISOR MANAGEMENT ====================

exports.createSupervisor = async (req, res) => {
  try {
    const {
      email,
      phone,
      password,
      fullName,
      assignedTechnicians = [],
      assignedClusters = []
    } = req.body;

    if (req.user.userType !== 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can create supervisor accounts'
      });
    }

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and full name are required'
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    const formattedTechnicians = Array.isArray(assignedTechnicians)
      ? assignedTechnicians
      : [];

    const formattedClusters = Array.isArray(assignedClusters)
      ? assignedClusters
      : [];

    if (formattedTechnicians.length > 0) {
      const existingTechnicians = await User.find({
        _id: { $in: formattedTechnicians },
        $or: [{ userType: 'technician' }, { role: 'technician' }]
      });

      if (existingTechnicians.length !== formattedTechnicians.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more assigned technicians do not exist'
        });
      }
    }

    if (formattedClusters.length > 0) {
      const existingClusters = await Cluster.find({
        _id: { $in: formattedClusters }
      });

      if (existingClusters.length !== formattedClusters.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more assigned clusters do not exist'
        });
      }
    }

    const supervisor = await User.create({
      email,
      phone,
      password,
      fullName,
      role: 'supervisor',
      userType: 'supervisor',
      isActive: true,
      assignedTechnicians: formattedTechnicians,
      assignedClusters: formattedClusters
    });

    res.status(201).json({
      success: true,
      message: 'Supervisor created successfully',
      data: {
        id: supervisor._id,
        email: supervisor.email,
        phone: supervisor.phone,
        fullName: supervisor.fullName,
        isActive: supervisor.isActive,
        assignedTechnicians: supervisor.assignedTechnicians,
        assignedClusters: supervisor.assignedClusters
      }
    });

  } catch (error) {
    logger.error('Create supervisor error:', error);

    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create supervisor account',
      error: error.message
    });
  }
};

exports.updateSupervisor = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      fullName,
      email,
      phone,
      assignedTechnicians = [],
      assignedClusters = [],
      isActive
    } = req.body;

    if (req.user.userType !== 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can update supervisor accounts'
      });
    }

    const supervisor = await User.findById(id);
    if (!supervisor || (supervisor.userType !== 'supervisor' && supervisor.role !== 'supervisor')) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    const formattedTechnicians = Array.isArray(assignedTechnicians)
      ? assignedTechnicians
      : [];

    const formattedClusters = Array.isArray(assignedClusters)
      ? assignedClusters
      : [];

    if (formattedTechnicians.length > 0) {
      const existingTechnicians = await User.find({
        _id: { $in: formattedTechnicians },
        $or: [{ userType: 'technician' }, { role: 'technician' }]
      });

      if (existingTechnicians.length !== formattedTechnicians.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more assigned technicians do not exist'
        });
      }
    }

    if (formattedClusters.length > 0) {
      const existingClusters = await Cluster.find({
        _id: { $in: formattedClusters }
      });

      if (existingClusters.length !== formattedClusters.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more assigned clusters do not exist'
        });
      }
    }

    const updates = {
      assignedTechnicians: formattedTechnicians,
      assignedClusters: formattedClusters,
      updatedAt: new Date()
    };

    if (fullName) updates.fullName = fullName;
    if (email) updates.email = email;
    if (phone) updates.phone = phone;
    if (typeof isActive === 'boolean') updates.isActive = isActive;

    const updatedSupervisor = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
      .populate('assignedTechnicians', 'fullName email phone')
      .populate('assignedClusters', 'name code region')
      .select('-password -refreshToken');

    res.status(200).json({
      success: true,
      message: 'Supervisor updated successfully',
      data: updatedSupervisor
    });

  } catch (error) {
    logger.error('Update supervisor error:', error);

    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update supervisor',
      error: error.message
    });
  }
};

exports.getSupervisorDashboard = async (req, res) => {
  try {
    // FIXED: Use req.user.userId instead of req.user._id
    const supervisorId = req.user.userId || req.user._id;

    const supervisor = await User.findById(supervisorId)
      .populate('assignedTechnicians', 'fullName email phone')
      .populate('assignedClusters', 'name code region')
      .lean();

    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    const technicianIds = supervisor.assignedTechnicians?.map(t => t._id) || [];

    const [
      pendingApprovals,
      scheduledMaintenance,
      completedThisWeek,
      overdueMaintenance
    ] = await Promise.all([
      Maintenance.countDocuments({
        technician: { $in: technicianIds },
        status: 'pending_approval'
      }),
      Maintenance.countDocuments({
        technician: { $in: technicianIds },
        status: 'scheduled'
      }),
      Maintenance.countDocuments({
        technician: { $in: technicianIds },
        status: 'completed',
        completedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }),
      Maintenance.countDocuments({
        technician: { $in: technicianIds },
        status: { $in: ['scheduled', 'in_progress'] },
        scheduledDate: { $lt: new Date() }
      })
    ]);

    const stats = {
      assignedTechnicians: technicianIds.length,
      assignedClusters: supervisor.assignedClusters?.length || 0,
      pendingApprovals,
      scheduledMaintenance,
      completedThisWeek,
      overdueMaintenance
    };

    res.status(200).json({
      success: true,
      data: {
        supervisor: {
          id: supervisor._id,
          fullName: supervisor.fullName,
          email: supervisor.email,
          phone: supervisor.phone
        },
        stats,
        technicians: supervisor.assignedTechnicians || [],
        clusters: supervisor.assignedClusters || []
      }
    });

  } catch (error) {
    logger.error('Error getting supervisor dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load dashboard data',
      error: error.message
    });
  }
};

exports.getSupervisorTowers = async (req, res) => {
  try {
    // FIXED: Use req.user.userId instead of req.user._id
    const supervisorId = req.user.userId || req.user._id;

    const supervisor = await User.findById(supervisorId)
      .select('assignedClusters')
      .lean();

    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    const clusters = await Cluster.find({
      _id: { $in: supervisor.assignedClusters || [] }
    }).select('towers').lean();

    const towerIds = [...new Set(clusters.flatMap(cluster => cluster.towers || []))];

    if (towerIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    const towers = await Tower.find({
      _id: { $in: towerIds }
    })
      .populate('cluster_id', 'name code region')
      .populate('supervisor', 'fullName email phone')
      .populate('primary_generator', 'model status current_stats')
      .populate('backup_generator', 'model status current_stats')
      .lean();

    res.status(200).json({
      success: true,
      data: towers
    });

  } catch (error) {
    logger.error('Error getting supervisor towers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve supervisor towers',
      error: error.message
    });
  }
};


// Replace your getSupervisorGenerators function in authController.js with this:

exports.getSupervisorGenerators = async (req, res) => {
  try {
    const supervisorId = req.user.userId || req.user._id;

    console.log('Getting generators for supervisor:', supervisorId);

    // Get supervisor with assigned clusters
    const supervisor = await User.findById(supervisorId)
      .select('assignedClusters')
      .lean();

    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    console.log('Supervisor assigned clusters:', supervisor.assignedClusters);

    // Get clusters and their towers
    const clusters = await Cluster.find({
      _id: { $in: supervisor.assignedClusters || [] }
    }).select('towers').lean();

    const towerIds = [...new Set(clusters.flatMap(cluster => cluster.towers || []))];

    console.log('Tower IDs:', towerIds);

    if (towerIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: []
      });
    }

    // Get towers with their site IDs
    const Tower = require('../models/Tower');
    const towers = await Tower.find({ _id: { $in: towerIds } })
      .select('_id name IHS_ID_SITE site_name')
      .lean();

    console.log('Towers found:', towers.length);

    // Extract site IDs (using IHS_ID_SITE or constructing from tower ID)
    const siteIds = towers.map(t => {
      if (t.IHS_ID_SITE) {
        return t.IHS_ID_SITE;
      }
      // Construct site ID from tower ID if not present
      const match = t._id.match(/TOWER([A-Z]{3})(\d{3})/);
      if (match) {
        return `IHS_${match[1]}_${match[2]}`;
      }
      return null;
    }).filter(Boolean);

    console.log('Site IDs:', siteIds);

    // Get approved generator updates for these sites
    const GeneratorUpdate = require('../models/GeneratorUpdate');
    const approvedUpdates = await GeneratorUpdate.find({
      site_id: { $in: siteIds },
      status: 'approved'
    })
      .sort({ reviewed_at: -1, submitted_at: -1 })
      .lean();

    console.log('Approved generator updates found:', approvedUpdates.length);

    // Build generator list from updates (one per site, most recent)
    const generatorsBySite = new Map();

    for (const update of approvedUpdates) {
      // Only keep the latest update per site
      if (generatorsBySite.has(update.site_id)) continue;

      // Find the corresponding tower
      const tower = towers.find(t =>
        t.IHS_ID_SITE === update.site_id ||
        `IHS_${t._id.match(/TOWER([A-Z]{3})(\d{3})/)?.[1]}_${t._id.match(/TOWER([A-Z]{3})(\d{3})/)?.[2]}` === update.site_id
      );

      if (tower) {
        // Create generator object from update
        const generator = {
          _id: update.new_generator_id || update.existing_generator_id || `GEN_${update.site_id}`,
          model: update.model,
          serial_number: update.serial_number,
          manufacturer: update.model?.split(' ')[0] || 'Unknown',
          tower_id: tower._id,
          tower_name: tower.name,
          site_id: update.site_id,
          specifications: {
            power_rating: update.power_rating,
            fuel_capacity: update.fuel_capacity,
            fuel_type: update.fuel_type
          },
          current_stats: {
            fuel: update.fuel_level || 100,
            power: update.power_output || 0,
            runtime: update.runtime || 0,
            temperature: update.temperature || 25
          },
          status: update.generator_status || 'standby',
          maintenance_interval: update.maintenance_interval,
          installation_date: update.installation_date,
          last_updated: update.reviewed_at || update.submitted_at,
          source: 'generator_update',
          update_id: update._id
        };

        generatorsBySite.set(update.site_id, generator);
      }
    }

    // Convert to array
    const generatorsArray = Array.from(generatorsBySite.values());

    console.log('Final generators count:', generatorsArray.length);

    res.status(200).json({
      success: true,
      count: generatorsArray.length,
      data: generatorsArray
    });

  } catch (error) {
    console.error('Error getting supervisor generators:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve supervisor generators',
      error: error.message
    });
  }
};


exports.getSupervisorACUnits = async (req, res) => {
  try {
    // FIXED: Use req.user.userId instead of req.user._id
    const supervisorId = req.user.userId || req.user._id;

    const supervisor = await User.findById(supervisorId)
      .select('assignedClusters');

    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    const clusters = await Cluster.find({
      _id: { $in: supervisor.assignedClusters }
    }).select('towers');

    const towerIds = [...new Set(clusters.flatMap(cluster => cluster.towers))];

    const acUnits = await ACUnit.find({
      tower: { $in: towerIds }
    });

    res.status(200).json({
      success: true,
      data: acUnits
    });
  } catch (error) {
    logger.error('Error getting supervisor AC units:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve supervisor AC units',
      error: error.message
    });
  }
};


exports.getSupervisorPowerSystems = async (req, res) => {
  try {
    // FIXED: Use req.user.userId instead of req.user._id
    const supervisorId = req.user.userId || req.user._id;

    const supervisor = await User.findById(supervisorId)
      .select('assignedClusters');

    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    const clusters = await Cluster.find({
      _id: { $in: supervisor.assignedClusters }
    }).select('towers');

    const towerIds = [...new Set(clusters.flatMap(cluster => cluster.towers))];

    const powerSystems = await PowerSystem.find({
      tower: { $in: towerIds }
    });

    res.status(200).json({
      success: true,
      data: powerSystems
    });
  } catch (error) {
    logger.error('Error getting supervisor power systems:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve supervisor power systems',
      error: error.message
    });
  }
};

exports.getSupervisedTechnicians = async (req, res) => {
  try {
    // FIXED: Use req.user.userId instead of req.user._id
    const supervisorId = req.user.userId || req.user._id;

    const supervisor = await User.findById(supervisorId)
      .populate({
        path: 'assignedTechnicians',
        match: { isActive: true },
        select: 'fullName email phone isActive role userType lastActive currentTasks specializations',
        populate: {
          path: 'currentTasks',
          select: 'type status scheduledDate tower',
          populate: {
            path: 'tower',
            select: 'name location'
          }
        }
      })
      .lean();

    if (!supervisor) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    const techniciansWithTaskCount = (supervisor.assignedTechnicians || []).map(tech => ({
      ...tech,
      currentTasksCount: tech.currentTasks?.length || 0
    }));

    res.status(200).json({
      success: true,
      data: techniciansWithTaskCount
    });

  } catch (error) {
    logger.error('Error getting supervised technicians:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve supervised technicians',
      error: error.message
    });
  }
};

exports.assignTechnicians = async (req, res) => {
  try {
    const { technicianIds } = req.body;
    // FIXED: Use req.user.userId instead of req.user._id
    const supervisorId = req.user.userId || req.user._id;

    const existingTechnicians = await User.find({
      _id: { $in: technicianIds },
      $or: [{ userType: 'technician' }, { role: 'technician' }]
    });

    if (existingTechnicians.length !== technicianIds.length) {
      return res.status(400).json({
        success: false,
        message: 'One or more technicians not found'
      });
    }

    const supervisor = await User.findByIdAndUpdate(
      supervisorId,
      { assignedTechnicians: technicianIds },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Technicians assigned successfully',
      data: supervisor
    });

  } catch (error) {
    logger.error('Error assigning technicians:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign technicians',
      error: error.message
    });
  }
};

// ==================== ANALYST MANAGEMENT ====================

exports.createAnalyst = async (req, res) => {
  try {
    if (req.user.userType !== 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can create analyst accounts'
      });
    }

    const { email, password, fullName, permissions } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and full name are required'
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists'
      });
    }

    const analyst = new User({
      email,
      password,
      fullName,
      userType: 'analyst',
      role: 'analyst',
      isActive: true,
      emailVerified: true,
      analystPermissions: permissions || {
        canUploadData: true,
        canGenerateReports: true,
        canViewAllClusters: true,
        canExportData: true
      }
    });

    await analyst.save();

    res.status(201).json({
      success: true,
      message: 'Analyst created successfully',
      data: {
        id: analyst._id,
        email: analyst.email,
        fullName: analyst.fullName,
        userType: analyst.userType,
        isActive: analyst.isActive,
        permissions: analyst.analystPermissions
      }
    });

  } catch (error) {
    logger.error('Error creating analyst:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create analyst account',
      error: error.message
    });
  }
};

// ==================== MAINTENANCE MANAGEMENT ====================

exports.getAllMaintenance = async (req, res) => {
  try {
    const {
      status,
      type,
      maintenanceType,
      technician,
      supervisor,
      tower,
      equipment,
      startDate,
      endDate,
      page = 1,
      limit = 20,
      sort = '-createdAt'
    } = req.query;

    const filter = {};

    if (status) {
      const statuses = status.split(',');
      filter.status = { $in: statuses };
    }

    if (type) filter.type = type;
    if (maintenanceType) filter.maintenanceType = maintenanceType;

    if (technician) {
      if (!mongoose.Types.ObjectId.isValid(technician)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid technician ID format'
        });
      }
      filter.technician = technician;
    }

    if (supervisor) {
      if (!mongoose.Types.ObjectId.isValid(supervisor)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid supervisor ID format'
        });
      }
      filter.supervisor = supervisor;
    }

    if (tower) {
      if (!mongoose.Types.ObjectId.isValid(tower)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid tower ID format'
        });
      }
      filter.tower = tower;
    }

    if (equipment) filter.equipment = equipment;

    if (startDate || endDate) {
      filter.scheduledDate = {};
      if (startDate) filter.scheduledDate.$gte = new Date(startDate);
      if (endDate) filter.scheduledDate.$lte = new Date(endDate);
    }

    if (req.user.userType === 'technician') {
      filter.technician = req.user._id;
    } else if (req.user.userType === 'supervisor') {
      const supervisor = await User.findById(req.user._id);
      filter.$or = [
        { technician: { $in: supervisor.assignedTechnicians } },
        { supervisor: req.user._id }
      ];
    }

    const skip = (page - 1) * limit;
    const total = await Maintenance.countDocuments(filter);

    const maintenance = await Maintenance.find(filter)
      .populate('technician', 'fullName email phone')
      .populate('supervisor', 'fullName email')
      .populate('tower', 'name location')
      .populate({
        path: 'equipment',
        select: 'model location _id'
      })
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      count: maintenance.length,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit),
      data: maintenance
    });

  } catch (error) {
    logger.error('Error getting maintenance records:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve maintenance records',
      error: error.message
    });
  }
};

exports.getPendingMaintenance = async (req, res) => {
  try {
    const supervisor = await User.findById(req.user._id);

    const pendingMaintenance = await Maintenance.find({
      technician: { $in: supervisor.assignedTechnicians },
      status: 'pending_approval'
    })
      .populate('technician', 'fullName email phone')
      .populate('tower')
      .populate({
        path: 'equipment',
        select: 'model location _id'
      });

    res.status(200).json({
      success: true,
      data: pendingMaintenance
    });
  } catch (error) {
    logger.error('Error getting pending maintenance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pending maintenance',
      error: error.message
    });
  }
};

exports.getScheduledMaintenance = async (req, res) => {
  try {
    const filter = {
      status: { $in: ['scheduled', 'pending', 'in_progress', 'completed'] }
    };

    // Role-based filtering
    if (req.user.userType === 'technician' || req.user.role === 'technician') {
      filter.technician = req.user.userId;
    } else if (req.user.userType === 'supervisor' || req.user.role === 'supervisor') {
      // Fetch supervisor data first
      const supervisor = await User.findById(req.user.userId)
        .select('assignedTechnicians')
        .lean();

      if (!supervisor) {
        return res.status(404).json({
          success: false,
          message: 'Supervisor not found'
        });
      }

      // Build filter for supervisor's maintenance records
      const technicianIds = supervisor.assignedTechnicians || [];

      filter.$or = [
        { technician: { $in: technicianIds } },
        { supervisor: req.user.userId }
      ];
    }

    const maintenance = await Maintenance.find(filter)
      .populate('technician', 'fullName technicianId phone email')
      .populate('supervisor', 'fullName supervisorId')
      .populate('tower', 'name location')
      .populate({
        path: 'equipment',
        select: 'model location _id status'
      })
      .sort({ scheduledDate: 1 })
      .limit(100)
      .lean();

    // Format the response data
    const formattedMaintenance = maintenance.map(m => ({
      ...m,
      technicianName: m.technician?.fullName || 'Unknown',
      equipmentName: m.equipmentName || m.equipment?.model || m.equipment?._id || 'Unknown'
    }));

    res.json({
      success: true,
      data: formattedMaintenance
    });

  } catch (error) {
    logger.error('Get scheduled maintenance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching scheduled maintenance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


exports.scheduleMaintenance = async (req, res) => {
  try {
    const {
      technician,
      maintenanceType,
      equipment,
      equipmentName,
      cleaningArea,
      tower,
      type,
      scheduledDate,
      notes,
      partsToReplace,
      priority,
      estimatedDuration,
      supervisor,
      createdBy
    } = req.body;

    console.log('Received maintenance data:', req.body);

    // Validate required fields
    const requiredFields = {
      technician,
      maintenanceType,
      tower,
      type,
      scheduledDate,
      supervisor,
      createdBy
    };

    if (maintenanceType !== 'site_cleaning') {
      requiredFields.equipment = equipment;
    } else {
      requiredFields.cleaningArea = cleaningArea;
    }

    const missingFields = Object.entries(requiredFields)
      .filter(([key, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(technician)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid technician ID format'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(supervisor)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid supervisor ID format'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(createdBy)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid createdBy ID format'
      });
    }

    // Validate tower ID format (TOWERXXX000)
    if (!/^TOWER[A-Z]{3}\d{3}$/.test(tower)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tower ID format. Expected format: TOWERXXX000'
      });
    }

    // Validate equipment if not site cleaning
    if (maintenanceType !== 'site_cleaning' && equipment) {
      let regex, errorMessage, Model;

      switch (maintenanceType) {
        case 'generator':
          regex = /^GEN[A-Z]{3}\d{3}$/;
          errorMessage = 'Invalid generator ID format. Expected format: GENXXX000';
          Model = require('../models/Generator');
          break;
        case 'ac':
          regex = /^AC[A-Z]{3}\d{3}$/;
          errorMessage = 'Invalid AC unit ID format. Expected format: ACXXX000';
          Model = require('../models/ACUnit');
          break;
        case 'power_system':
          regex = /^PS[A-Z]{3}\d{3}$/;
          errorMessage = 'Invalid power system ID format. Expected format: PSXXX000';
          Model = require('../models/PowerSystem');
          break;
        default:
          return res.status(400).json({
            success: false,
            message: `Invalid maintenance type: ${maintenanceType}`
          });
      }

      if (!regex.test(equipment)) {
        console.log('Invalid equipment ID:', equipment, 'Type:', maintenanceType);
        return res.status(400).json({
          success: false,
          message: errorMessage,
          received: equipment
        });
      }

      // Check if equipment exists
      const equipmentExists = await Model.findById(equipment);
      if (!equipmentExists) {
        return res.status(404).json({
          success: false,
          message: `${maintenanceType === 'generator' ? 'Generator' :
            maintenanceType === 'ac' ? 'AC Unit' : 'Power System'} not found with ID: ${equipment}`
        });
      }
    }

    // Validate tower exists
    const towerExists = await mongoose.model('Tower').findById(tower);
    if (!towerExists) {
      return res.status(404).json({
        success: false,
        message: 'Tower not found'
      });
    }

    // Validate scheduled date
    const scheduledDateTime = new Date(scheduledDate);
    if (isNaN(scheduledDateTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid scheduled date format'
      });
    }

    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);

    if (scheduledDateTime < oneMinuteAgo) {
      return res.status(400).json({
        success: false,
        message: 'Scheduled date must be in the future'
      });
    }

    // Validate maintenance type
    const validTypes = ['routine', 'repair', 'inspection', 'emergency'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Invalid maintenance type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Validate technician exists and is active
    const technicianUser = await User.findOne({
      _id: new mongoose.Types.ObjectId(technician),
      $or: [{ userType: 'technician' }, { role: 'technician' }],
      isActive: true
    });

    if (!technicianUser) {
      return res.status(404).json({
        success: false,
        message: 'Technician not found or inactive'
      });
    }

    // Process parts to replace
    const validatedPartsToReplace = [];
    if (maintenanceType !== 'site_cleaning' && partsToReplace && Array.isArray(partsToReplace)) {
      for (const part of partsToReplace) {
        if (part.part_id || part.part) {
          const partId = part.part_id || part.part;
          if (mongoose.Types.ObjectId.isValid(partId)) {
            validatedPartsToReplace.push({
              part: new mongoose.Types.ObjectId(partId),
              name: part.name || '',
              quantity: parseInt(part.quantity) || 1
            });
          }
        }
      }
    }

    // Check for scheduling conflicts
    const startWindow = new Date(scheduledDateTime.getTime() - 2 * 60 * 60 * 1000);
    const endWindow = new Date(scheduledDateTime.getTime() + 2 * 60 * 60 * 1000);

    const existingMaintenance = await Maintenance.findOne({
      technician: new mongoose.Types.ObjectId(technician),
      scheduledDate: {
        $gte: startWindow,
        $lte: endWindow
      },
      status: { $in: ['scheduled', 'in_progress', 'pending'] }
    });

    if (existingMaintenance) {
      return res.status(409).json({
        success: false,
        message: 'Technician already has maintenance scheduled within 2 hours of this time',
        conflictingMaintenance: {
          id: existingMaintenance._id,
          scheduledDate: existingMaintenance.scheduledDate,
          type: existingMaintenance.type
        }
      });
    }

    // Create maintenance record
    const maintenance = new Maintenance({
      technician: new mongoose.Types.ObjectId(technician),
      maintenanceType,
      equipment: maintenanceType !== 'site_cleaning' ? equipment : undefined,
      equipmentName: maintenanceType !== 'site_cleaning' ? equipmentName : undefined,
      cleaningArea: maintenanceType === 'site_cleaning' ? cleaningArea : undefined,
      tower: tower,
      type,
      scheduledDate: scheduledDateTime,
      notes: notes?.trim() || '',
      partsToReplace: validatedPartsToReplace,
      supervisor: new mongoose.Types.ObjectId(supervisor),
      createdBy: new mongoose.Types.ObjectId(createdBy),
      priority: priority || 'medium',
      estimatedDuration: estimatedDuration || null,
      status: 'scheduled',
      technicianName: technicianUser.fullName,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const savedMaintenance = await maintenance.save();

    // Update technician's current tasks
    await User.findByIdAndUpdate(
      technician,
      { $addToSet: { currentTasks: savedMaintenance._id } }
    );

    // Populate the response
    const populatedMaintenance = await Maintenance.findById(savedMaintenance._id)
      .populate('technician', 'fullName email phone')
      .populate('supervisor', 'fullName email')
      .populate('createdBy', 'fullName email')
      .populate('tower', 'name location')
      .populate('partsToReplace.part', 'name part_number');

    logger.info('Maintenance scheduled successfully', {
      maintenanceId: savedMaintenance._id,
      technicianId: technician,
      supervisorId: supervisor,
      type: maintenanceType
    });

    res.status(201).json({
      success: true,
      message: 'Maintenance scheduled successfully',
      data: populatedMaintenance
    });

  } catch (error) {
    logger.error('Error scheduling maintenance:', error);

    if (error.message.includes('Invalid') ||
      error.message.includes('Missing') ||
      error.message.includes('must be')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Internal server error while scheduling maintenance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.approveMaintenance = async (req, res) => {
  try {
    const { id } = req.params;
    const maintenance = await Maintenance.findById(id);

    if (!maintenance) {
      return res.status(404).json({
        success: false,
        message: 'Maintenance record not found'
      });
    }

    maintenance.status = 'approved';
    maintenance.approvedBy = req.user._id;
    maintenance.approvedAt = new Date();
    await maintenance.save();

    res.status(200).json({
      success: true,
      message: 'Maintenance approved successfully',
      data: maintenance
    });

  } catch (error) {
    logger.error('Error approving maintenance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve maintenance',
      error: error.message
    });
  }
};

exports.createMaintenance = async (req, res) => {
  try {
    const {
      generator,
      tower,
      type,
      scheduledDate,
      technician,
      supervisor,
      createdBy,
      partsToReplace,
      notes,
      beforePhotos
    } = req.body;

    if (!generator || !tower || !type || !technician || !supervisor || !createdBy) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const maintenance = new Maintenance({
      generator,
      tower,
      type,
      scheduledDate: scheduledDate || new Date(),
      technician,
      supervisor,
      createdBy,
      partsToReplace: partsToReplace || [],
      notes: notes || '',
      beforePhotos: beforePhotos || [],
      status: 'completed',
      completedAt: new Date()
    });

    await maintenance.save();

    await mongoose.model('Generator').updateOne(
      { _id: generator },
      { last_maintenance: new Date() }
    );

    res.status(201).json({
      success: true,
      message: 'Maintenance record created successfully',
      data: maintenance
    });
  } catch (error) {
    logger.error('Error creating maintenance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create maintenance record',
      error: error.message
    });
  }
};

exports.updateMaintenanceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['in_progress', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const maintenance = await Maintenance.findById(id)
      .populate('technician', '_id');

    if (!maintenance) {
      return res.status(404).json({
        success: false,
        message: 'Maintenance record not found'
      });
    }

    if (maintenance.technician._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own maintenance tasks'
      });
    }

    if (status === 'in_progress' && maintenance.status !== 'scheduled') {
      return res.status(400).json({
        success: false,
        message: 'Can only start maintenance that is in scheduled status'
      });
    }

    if (status === 'completed' && maintenance.status !== 'in_progress') {
      return res.status(400).json({
        success: false,
        message: 'Can only complete maintenance that is in progress'
      });
    }

    maintenance.status = status;

    if (status === 'completed') {
      maintenance.completedAt = new Date();
    }

    await maintenance.save();

    res.status(200).json({
      success: true,
      message: 'Maintenance status updated successfully',
      data: maintenance
    });

  } catch (error) {
    logger.error('Error updating maintenance status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update maintenance status',
      error: error.message
    });
  }
};

// ==================== EQUIPMENT MANAGEMENT ====================

exports.getEquipmentByType = async (req, res) => {
  try {
    const { type, tower } = req.query;

    let model;
    switch (type) {
      case 'generator':
        model = 'Generator';
        break;
      case 'ac':
        model = 'ACUnit';
        break;
      case 'power_system':
        model = 'PowerSystem';
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid equipment type'
        });
    }

    let query = {};
    if (tower) {
      query.tower = tower;
    }

    const equipment = await mongoose.model(model).find(query)
      .select('_id model location status')
      .lean();

    res.status(200).json({
      success: true,
      data: equipment
    });

  } catch (error) {
    logger.error('Error getting equipment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get equipment',
      error: error.message
    });
  }
};

exports.createACUnit = async (req, res) => {
  await createEquipment(ACUnit, req, res);
};

exports.createPowerSystem = async (req, res) => {
  await createEquipment(PowerSystem, req, res);
};

// ==================== SITE DATA MANAGEMENT ====================

exports.getSupervisorsFromSites = async (req, res) => {
  try {
    const supervisorAggregation = await Site.aggregate([
      {
        $match: {
          SBC_Supervisor: { $exists: true, $ne: null, $ne: '' }
        }
      },
      {
        $group: {
          _id: '$SBC_Supervisor',
          supervisorName: { $first: '$SBC_Supervisor' },
          email: { $first: '$Email_Address_SBC_Supervisor' },
          contact: { $first: '$SBC_Supervisor_contact' },
          assignedSites: {
            $push: {
              ihsIdSite: '$IHS_ID_SITE',
              siteName: '$Site_Name',
              region: '$Region',
              gratoCluster: '$GRATO_Cluster',
              priority: '$Sites_Priority',
              siteType: '$Sites_Type'
            }
          },
          totalSites: { $sum: 1 },
          highPriority: {
            $sum: {
              $cond: [
                { $eq: ['$Sites_Priority', 'High'] },
                1,
                0
              ]
            }
          },
          mediumPriority: {
            $sum: {
              $cond: [
                { $eq: ['$Sites_Priority', 'Medium'] },
                1,
                0
              ]
            }
          },
          lowPriority: {
            $sum: {
              $cond: [
                { $eq: ['$Sites_Priority', 'Low'] },
                1,
                0
              ]
            }
          },
          assignedClusters: { $addToSet: '$GRATO_Cluster' },
          regions: { $addToSet: '$Region' }
        }
      },
      {
        $sort: { supervisorName: 1 }
      }
    ]);

    const supervisors = supervisorAggregation.map(supervisor => ({
      _id: supervisor._id,
      fullName: supervisor.supervisorName,
      email: supervisor.email || null,
      phone: supervisor.contact || null,
      isActive: true,
      userType: 'supervisor',
      assignedSites: supervisor.assignedSites,
      assignedClusters: supervisor.assignedClusters.filter(cluster => cluster),
      totalSites: supervisor.totalSites,
      stats: {
        total_sites: supervisor.totalSites,
        high_priority_sites: supervisor.highPriority,
        medium_priority_sites: supervisor.mediumPriority,
        low_priority_sites: supervisor.lowPriority,
        clusters_count: supervisor.assignedClusters.filter(cluster => cluster).length,
        regions: supervisor.regions.filter(region => region)
      }
    }));

    res.status(200).json({
      success: true,
      data: supervisors,
      count: supervisors.length
    });

  } catch (error) {
    logger.error('Error fetching supervisors from sites:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supervisor data from sites',
      error: error.message
    });
  }
};

exports.getSupervisorFromSites = async (req, res) => {
  try {
    const { supervisorName } = req.params;

    const sites = await Site.find({
      SBC_Supervisor: supervisorName
    }).lean();

    if (sites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found or has no assigned sites'
      });
    }

    const supervisorInfo = sites[0];

    const stats = {
      total_sites: sites.length,
      sites_by_priority: sites.reduce((acc, site) => {
        const priority = site.Sites_Priority || 'Unknown';
        acc[priority] = (acc[priority] || 0) + 1;
        return acc;
      }, {}),
      sites_by_type: sites.reduce((acc, site) => {
        const type = site.Sites_Type || 'Unknown';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
      clusters: [...new Set(sites.map(site => site.GRATO_Cluster).filter(Boolean))],
      regions: [...new Set(sites.map(site => site.Region).filter(Boolean))],
      total_tenants: sites.reduce((sum, site) => sum + (site.Tenants_Count || 0), 0)
    };

    const supervisorData = {
      _id: supervisorName,
      fullName: supervisorInfo.SBC_Supervisor,
      email: supervisorInfo.Email_Address_SBC_Supervisor,
      phone: supervisorInfo.SBC_Supervisor_contact,
      isActive: true,
      userType: 'supervisor',
      assignedSites: sites.map(site => ({
        ihsIdSite: site.IHS_ID_SITE,
        siteName: site.Site_Name,
        region: site.Region,
        gratoCluster: site.GRATO_Cluster,
        priority: site.Sites_Priority,
        siteType: site.Sites_Type,
        tenantsCount: site.Tenants_Count
      })),
      assignedClusters: stats.clusters,
      stats
    };

    res.status(200).json({
      success: true,
      data: supervisorData
    });

  } catch (error) {
    logger.error('Error fetching supervisor details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch supervisor details',
      error: error.message
    });
  }
};

exports.getTechniciansFromSites = async (req, res) => {
  try {
    const technicianAggregation = await Site.aggregate([
      {
        $match: {
          Technician_Name: { $exists: true, $ne: null, $ne: '' }
        }
      },
      {
        $group: {
          _id: '$Technician_Name',
          technicianName: { $first: '$Technician_Name' },
          contact: { $first: '$Technician_Contact' },
          assignedSites: {
            $push: {
              ihsIdSite: '$IHS_ID_SITE',
              siteName: '$Site_Name',
              region: '$Region',
              gratoCluster: '$GRATO_Cluster'
            }
          },
          totalSites: { $sum: 1 },
          regions: { $addToSet: '$Region' }
        }
      },
      {
        $sort: { technicianName: 1 }
      }
    ]);

    const technicians = technicianAggregation.map(tech => ({
      _id: tech._id,
      fullName: tech.technicianName,
      phone: tech.contact,
      email: null,
      isActive: true,
      userType: 'technician',
      assignedSites: tech.assignedSites,
      totalSites: tech.totalSites,
      regions: tech.regions.filter(region => region)
    }));

    res.status(200).json({
      success: true,
      data: technicians,
      count: technicians.length
    });

  } catch (error) {
    logger.error('Error fetching technicians from sites:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch technician data from sites',
      error: error.message
    });
  }
};

exports.updateSupervisorInSites = async (req, res) => {
  try {
    const { supervisorName } = req.params;
    const {
      newSupervisorName,
      email,
      contact
    } = req.body;

    const sites = await Site.find({ SBC_Supervisor: supervisorName });

    if (sites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Supervisor not found'
      });
    }

    const updateData = {};
    if (newSupervisorName && newSupervisorName !== supervisorName) {
      updateData.SBC_Supervisor = newSupervisorName;
    }
    if (email !== undefined) {
      updateData.Email_Address_SBC_Supervisor = email;
    }
    if (contact !== undefined) {
      updateData.SBC_Supervisor_contact = contact;
    }

    const result = await Site.updateMany(
      { SBC_Supervisor: supervisorName },
      { $set: updateData }
    );

    res.status(200).json({
      success: true,
      message: 'Supervisor information updated successfully',
      updatedSites: result.modifiedCount
    });

  } catch (error) {
    logger.error('Error updating supervisor:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update supervisor information',
      error: error.message
    });
  }
};

exports.updateSupervisorContactInSites = async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, phone } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updateData = {};
    if (fullName && fullName !== user.fullName) {
      updateData.SBC_Supervisor = fullName;
    }
    if (email !== undefined) {
      updateData.Email_Address_SBC_Supervisor = email;
    }
    if (phone !== undefined) {
      updateData.SBC_Supervisor_contact = phone;
    }

    const result = await Site.updateMany(
      { SBC_Supervisor: user.fullName },
      { $set: updateData }
    );

    res.status(200).json({
      success: true,
      message: 'Supervisor contact information synced to sites',
      sitesUpdated: result.modifiedCount
    });

  } catch (error) {
    logger.error('Error updating supervisor contact in sites:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync supervisor contact to sites',
      error: error.message
    });
  }
};

exports.updateTechnicianInSites = async (req, res) => {
  try {
    const { technicianName } = req.params;
    const {
      newTechnicianName,
      email,
      contact
    } = req.body;

    const sites = await Site.find({ Technician_Name: technicianName });

    if (sites.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Technician not found in site data'
      });
    }

    const updateData = {};
    if (newTechnicianName && newTechnicianName !== technicianName) {
      updateData.Technician_Name = newTechnicianName;
    }
    if (contact !== undefined) {
      updateData.Technician_Contact = contact;
    }

    const result = await Site.updateMany(
      { Technician_Name: technicianName },
      { $set: updateData }
    );

    res.status(200).json({
      success: true,
      message: 'Technician information updated successfully in site data',
      updatedSites: result.modifiedCount
    });

  } catch (error) {
    logger.error('Error updating technician in sites:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update technician information in sites',
      error: error.message
    });
  }
};

exports.updateTechnicianContactInSites = async (req, res) => {
  try {
    const { userId } = req.params;
    const { fullName, email, phone } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updateData = {};
    if (fullName && fullName !== user.fullName) {
      updateData.Technician_Name = fullName;
    }
    if (phone !== undefined) {
      updateData.Technician_Contact = phone;
    }

    const result = await Site.updateMany(
      { Technician_Name: user.fullName },
      { $set: updateData }
    );

    res.status(200).json({
      success: true,
      message: 'Technician contact information synced to sites',
      sitesUpdated: result.modifiedCount
    });

  } catch (error) {
    logger.error('Error updating technician contact in sites:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync technician contact to sites',
      error: error.message
    });
  }
};



