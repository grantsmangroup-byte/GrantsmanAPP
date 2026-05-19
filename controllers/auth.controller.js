const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Guard = require('../models/Guard');
const Agency = require('../models/Agency');

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

exports.guardLogin = async (req, res) => {
  try {
    const { phone, password } = req.body;

    // Find user by phone
    const user = await User.findOne({ phone, role: 'guard' });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: { message: 'Invalid phone number or password', code: 'INVALID_CREDENTIALS' }
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        error: { message: 'Invalid phone number or password', code: 'INVALID_CREDENTIALS' }
      });
    }

    if (!user.isActive) {
      return res.status(403).json({ 
        success: false, 
        error: { message: 'Account is inactive', code: 'ACCOUNT_INACTIVE' }
      });
    }

    // Get guard details
    const guard = await Guard.findOne({ userId: user._id })
      .populate('assignedSiteId', 'name address latitude longitude geofenceRadius')
      .populate('agencyId', 'name');

    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard profile not found', code: 'NOT_FOUND' }
      });
    }

    const token = generateToken(user._id);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.fullName,
          phone: user.phone,
          role: user.role,
          agencyId: guard.agencyId._id,
          agencyName: guard.agencyId.name,
          assignedSiteId: guard.assignedSiteId?._id,
          siteName: guard.assignedSiteId?.name,
          siteLocation: guard.assignedSiteId ? {
            latitude: guard.assignedSiteId.latitude,
            longitude: guard.assignedSiteId.longitude,
            radius: guard.assignedSiteId.geofenceRadius
          } : null,
          device: guard.device,
          shiftStart: guard.shiftStart,
          shiftEnd: guard.shiftEnd,
          status: guard.status
        }
      }
    });
  } catch (error) {
    console.error('Guard login error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Login failed', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'User not found', code: 'NOT_FOUND' }
      });
    }

    let profileData = user.toObject();

    // If guard, include guard-specific data
    if (user.role === 'guard') {
      const guard = await Guard.findOne({ userId: user._id })
        .populate('assignedSiteId')
        .populate('agencyId');
      
      profileData = {
        ...profileData,
        guardDetails: guard
      };
    }

    res.json({ success: true, data: profileData });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to fetch profile', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.logout = async (req, res) => {
  // In a production app, you'd invalidate the token here
  // For now, we just send success response
  res.json({ success: true, message: 'Logged out successfully' });
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email })
      .populate('agencyId', 'name')
      .select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' }
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: { message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' }
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        error: { message: 'Account is inactive', code: 'ACCOUNT_INACTIVE' }
      });
    }

    const accessToken = generateToken(user._id);

    res.json({
      success: true,
      data: {
        accessToken,
        user: {
          id: user._id,
          _id: user._id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          role: user.role,
          agencyId: user.agencyId?._id || null,
          agencyName: user.agencyId?.name || null,
          isActive: user.isActive
        }
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Login failed', code: 'INTERNAL_ERROR' }
    });
  }
};