const { validationResult } = require('express-validator');

exports.validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false, 
      error: { 
        message: 'Validation failed', 
        code: 'VALIDATION_ERROR',
        errors: errors.array() 
      }
    });
  }
  next();
};