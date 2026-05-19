const Guard = require('../models/Guard');
const User  = require('../models/User');

// PATCH /api/guard/push-token
exports.registerPushToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, error: { message: 'Token required' } });

    await Guard.findOneAndUpdate(
      { userId: req.userId },
      { pushToken: token },
      { new: true }
    );

    return res.json({ success: true, message: 'Push token registered' });
  } catch (err) {
    console.error('registerPushToken:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to register token' } });
  }
};

// DELETE /api/guard/push-token  (on logout)
exports.removePushToken = async (req, res) => {
  try {
    await Guard.findOneAndUpdate({ userId: req.userId }, { $unset: { pushToken: 1 } });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to remove token' } });
  }
};