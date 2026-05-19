// exports.ensureTenancy = (req, res, next) => {
//   // Ensure requests are scoped to the user's agency
//   if (req.user.role !== 'super-admin' && !req.agencyId) {
//     return res.status(403).json({ 
//       success: false, 
//       error: { message: 'Agency context required', code: 'FORBIDDEN' }
//     });
//   }
//   next();
// };


// middleware/tenancy.middleware.js
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

exports.ensureTenancy = (req, res, next) => {
  if (req.user.role !== 'super-admin' && !req.agencyId) {
    return res.status(403).json({
      success: false,
      error: { message: 'Agency context required', code: 'FORBIDDEN' }
    });
  }
  next();
};

exports.agencyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  keyGenerator: (req) => req.agencyId || ipKeyGenerator(req),
});

exports.pingRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.agencyId || ipKeyGenerator(req),
});

exports.injectScopedQuery = (req, res, next) => {
  req.scopedQuery = { agencyId: req.agencyId };
  next();
};