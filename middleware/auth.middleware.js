const jwt   = require('jsonwebtoken');
const User  = require('../models/User');
const Guard = require('../models/Guard');

// ── Verify JWT and attach userId + role ───────────────────────────────────────
exports.authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'No token provided', code: 'UNAUTHENTICATED' } });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId).select('-password');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: { message: 'Invalid or inactive account', code: 'UNAUTHENTICATED' } });
    }

    req.userId   = user._id;
    req.userRole = user.role;
    req.agencyId = user.agencyId || null;

    // For guards, resolve agencyId from Guard profile if not on User
    if (user.role === 'guard' && !req.agencyId) {
      const guard = await Guard.findOne({ userId: user._id }).select('agencyId');
      req.agencyId = guard?.agencyId || null;
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: { message: 'Token expired', code: 'TOKEN_EXPIRED' } });
    }
    return res.status(401).json({ success: false, error: { message: 'Invalid token', code: 'UNAUTHENTICATED' } });
  }
};

// ── Role-based access — pass allowed roles as rest args ───────────────────────
// Usage: authorize('agency-admin', 'supervisor')
exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.userRole)) {
    return res.status(403).json({
      success: false,
      error: { message: `Role '${req.userRole}' is not permitted`, code: 'FORBIDDEN' },
    });
  }
  next();
};

// ── Enforce agency scope on all requests (guards, admins, supervisors) ────────
// Blocks cross-agency data access even if route logic forgets to filter.
exports.enforceAgencyScope = (req, res, next) => {
  if (!req.agencyId && req.userRole !== 'super-admin') {
    return res.status(403).json({
      success: false,
      error: { message: 'No agency scope', code: 'FORBIDDEN' },
    });
  }
  next();
};

// ── Client portal auth: validate client JWT ───────────────────────────────────
exports.authenticateClient = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { message: 'No token', code: 'UNAUTHENTICATED' } });
    }
    const token   = authHeader.slice(7);
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);
    if (!user || user.role !== 'client') {
      return res.status(401).json({ success: false, error: { message: 'Not a client account', code: 'FORBIDDEN' } });
    }

    req.userId   = user._id;
    req.userRole = user.role;
    req.agencyId = user.agencyId;
    req.siteIds  = user.assignedSiteIds || []; // client sees only their sites

    next();
  } catch {
    return res.status(401).json({ success: false, error: { message: 'Invalid token', code: 'UNAUTHENTICATED' } });
  }
};








// const jwt = require('jsonwebtoken');
// const User = require('../models/User');

// exports.authenticate = async (req, res, next) => {
//   try {
//     const token = req.headers.authorization?.replace('Bearer ', '');
    
//     if (!token) {
//       return res.status(401).json({ 
//         success: false, 
//         error: { message: 'No token provided', code: 'UNAUTHORIZED' }
//       });
//     }

//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     const user = await User.findById(decoded.userId);

//     if (!user || !user.isActive) {
//       return res.status(401).json({ 
//         success: false, 
//         error: { message: 'Invalid token', code: 'UNAUTHORIZED' }
//       });
//     }

//     req.user = user;
//     req.userId = user._id;
//     req.agencyId = user.agencyId;
//     next();
//   } catch (error) {
//     console.error('Auth error:', error);
//     return res.status(401).json({ 
//       success: false, 
//       error: { message: 'Authentication failed', code: 'UNAUTHORIZED' }
//     });
//   }
// };

// exports.authorize = (...roles) => {
//   return (req, res, next) => {
//     if (!roles.includes(req.user.role)) {
//       return res.status(403).json({ 
//         success: false, 
//         error: { message: 'Insufficient permissions', code: 'FORBIDDEN' }
//       });
//     }
//     next();
//   };
// };