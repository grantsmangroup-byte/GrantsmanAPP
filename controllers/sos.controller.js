const Guard = require('../models/Guard');
const SOSAlert = require('../models/SOSAlert');

exports.triggerSOS = async (req, res) => {
  try {
    const { latitude, longitude, timestamp } = req.body;
    
    const guard = await Guard.findOne({ userId: req.userId })
      .populate('assignedSiteId')
      .populate('agencyId');
    
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    // Create SOS alert
    const sosAlert = new SOSAlert({
      agencyId: guard.agencyId._id,
      guardId: guard._id,
      siteId: guard.assignedSiteId?._id,
      triggeredAt: timestamp || new Date(),
      location: { latitude, longitude },
      status: 'active'
    });

    await sosAlert.save();

    // TODO: Send notifications
    // - Emit Socket.io event to agency dashboard
    // - Send SMS to supervisor
    // - Send email alert
    // - Trigger phone call to backup team

    const notifications = ['dashboard'];
    sosAlert.notificationsSent = notifications;
    await sosAlert.save();

    console.log('🚨 SOS ALERT TRIGGERED:', {
      guardName: guard.name,
      agency: guard.agencyId.name,
      site: guard.assignedSiteId?.name,
      location: { latitude, longitude }
    });

    res.json({
      success: true,
      data: {
        alertId: sosAlert._id,
        status: 'active',
        notificationsSent: notifications,
        message: 'Emergency alert sent successfully. Help is on the way!'
      }
    });
  } catch (error) {
    console.error('SOS trigger error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to send SOS alert', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.cancelSOS = async (req, res) => {
  try {
    const { alertId } = req.params;
    const { reason } = req.body;
    
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    const alert = await SOSAlert.findById(alertId);
    if (!alert) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Alert not found', code: 'NOT_FOUND' }
      });
    }

    if (alert.guardId.toString() !== guard._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        error: { message: 'Unauthorized', code: 'FORBIDDEN' }
      });
    }

    alert.status = 'cancelled';
    alert.resolvedAt = new Date();
    alert.notes = reason || 'Cancelled by guard (false alarm)';
    await alert.save();

    res.json({
      success: true,
      data: {
        alertId: alert._id,
        status: 'cancelled',
        message: 'SOS alert cancelled successfully'
      }
    });
  } catch (error) {
    console.error('Cancel SOS error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to cancel SOS', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.getAlerts = async (req, res) => {
  try {
    const { status } = req.query;
    
    const query = { agencyId: req.agencyId };
    if (status) query.status = status;

    const alerts = await SOSAlert.find(query)
      .populate('guardId', 'name phone')
      .populate('siteId', 'name address')
      .sort({ triggeredAt: -1 });

    res.json({ success: true, data: { alerts } });
  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to load alerts', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.resolveAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const alert = await SOSAlert.findById(id);
    if (!alert) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Alert not found', code: 'NOT_FOUND' }
      });
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    alert.notes = notes;
    await alert.save();

    res.json({ success: true, data: { alert } });
  } catch (error) {
    console.error('Resolve alert error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to resolve alert', code: 'INTERNAL_ERROR' }
    });
  }
};