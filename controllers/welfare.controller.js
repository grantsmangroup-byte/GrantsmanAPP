const Guard = require('../models/Guard');
const WelfareCall = require('../models/WelfareCall');
const Site = require('../models/Site');
const { isWithinGeofence } = require('../utils/geofence');

const getWebhookBaseUrl = (req) => {
  const configured = (process.env.TWILIO_WEBHOOK_BASE_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
};

const updateGuardAlertnessScore = async (guardId) => {
  const recentCalls = await WelfareCall.find({
    guardId,
    scheduledAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  });

  const answeredCount = recentCalls.filter((call) => call.status === 'answered').length;
  const total = recentCalls.length;
  const alertnessScore = total > 0 ? Math.round((answeredCount / total) * 100) : 100;

  await Guard.findByIdAndUpdate(guardId, { alertnessScore });
  return alertnessScore;
};

exports.respondToCall = async (req, res) => {
  try {
    const { callId, location, answeredAt } = req.body;
    
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    const call = await WelfareCall.findById(callId);
    if (!call) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Welfare call not found', code: 'NOT_FOUND' }
      });
    }

    if (call.guardId.toString() !== guard._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        error: { message: 'Unauthorized', code: 'FORBIDDEN' }
      });
    }

    // Check geofence if location provided
    let withinGeofence = null;
    if (location && location.latitude && location.longitude) {
      const site = await Site.findById(guard.assignedSiteId);
      if (site) {
        withinGeofence = isWithinGeofence(
          location.latitude,
          location.longitude,
          site.latitude,
          site.longitude,
          site.geofenceRadius
        );
      }
    }

    // Update welfare call
    call.answeredAt = answeredAt || new Date();
    call.status = 'answered';
    call.location = location;
    call.withinGeofence = withinGeofence;
    await call.save();

    const alertnessScore = await updateGuardAlertnessScore(guard._id);

    res.json({
      success: true,
      data: {
        verified: true,
        withinGeofence,
        alertnessScore,
        message: 'Welfare check confirmed successfully'
      }
    });
  } catch (error) {
    console.error('Respond to call error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to process response', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.getPendingChecks = async (req, res) => {
  try {
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    const pendingChecks = await WelfareCall.find({
      guardId: guard._id,
      status: 'scheduled',
      scheduledAt: { $lte: new Date() }
    }).sort({ scheduledAt: -1 });

    res.json({
      success: true,
      data: { checks: pendingChecks }
    });
  } catch (error) {
    console.error('Get pending checks error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to load checks', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.confirmAlertness = async (req, res) => {
  try {
    const latitude = req.body.latitude ?? req.body.location?.latitude;
    const longitude = req.body.longitude ?? req.body.location?.longitude;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Valid latitude and longitude required', code: 'VALIDATION_ERROR' }
      });
    }
    
    const guard = await Guard.findOne({ userId: req.userId });
    if (!guard) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Guard not found', code: 'NOT_FOUND' }
      });
    }

    // Create manual welfare confirmation
    const confirmation = new WelfareCall({
      agencyId: guard.agencyId,
      guardId: guard._id,
      siteId: guard.assignedSiteId,
      shiftId: guard.currentShiftId,
      scheduledAt: new Date(),
      answeredAt: new Date(),
      status: 'answered',
      location: { latitude, longitude }
    });

    // Check geofence
    const site = await Site.findById(guard.assignedSiteId);
    if (site) {
      confirmation.withinGeofence = isWithinGeofence(
        latitude,
        longitude,
        site.latitude,
        site.longitude,
        site.geofenceRadius
      );
    }

    await confirmation.save();

    res.json({
      success: true,
      data: {
        confirmed: true,
        timestamp: confirmation.answeredAt,
        withinGeofence: confirmation.withinGeofence
      }
    });
  } catch (error) {
    console.error('Confirm alertness error:', error);
    res.status(500).json({ 
      success: false, 
      error: { message: 'Failed to confirm alertness', code: 'INTERNAL_ERROR' }
    });
  }
};

exports.twilioVoiceWebhook = async (req, res) => {
  try {
    const callId = req.query.callId || req.body.callId;
    const baseUrl = getWebhookBaseUrl(req);
    const verifyUrl = `${baseUrl}/api/welfare/twilio/verify?callId=${callId}`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${verifyUrl}" method="POST" timeout="8">
    <Say voice="alice">This is Grantsman welfare check. Press 1 now to confirm you are alert and safe on post.</Say>
  </Gather>
  <Say voice="alice">No response detected. This welfare check will be marked missed.</Say>
  <Hangup/>
</Response>`;

    res.type('text/xml').status(200).send(xml);
  } catch (error) {
    console.error('Twilio voice webhook error:', error);
    res.status(500).send('Webhook error');
  }
};

exports.twilioVerifyResponse = async (req, res) => {
  try {
    const callId = req.query.callId || req.body.callId;
    const digits = String(req.body.Digits || '').trim();

    const call = await WelfareCall.findById(callId);
    if (!call) {
      res.type('text/xml').status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Call record not found.</Say><Hangup/></Response>');
      return;
    }

    if (digits === '1') {
      call.status = 'answered';
      call.answeredAt = new Date();
      await call.save();
      await updateGuardAlertnessScore(call.guardId);

      res.type('text/xml').status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Thank you. Welfare check confirmed.</Say><Hangup/></Response>');
      return;
    }

    if (call.status !== 'answered') {
      call.status = 'missed';
      await call.save();
      await updateGuardAlertnessScore(call.guardId);
    }

    res.type('text/xml').status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Invalid input. Welfare check marked missed.</Say><Hangup/></Response>');
  } catch (error) {
    console.error('Twilio verify webhook error:', error);
    res.status(500).send('Webhook error');
  }
};

exports.twilioStatusWebhook = async (req, res) => {
  try {
    const callId = req.query.callId || req.body.callId;
    const callStatus = req.body.CallStatus;

    const call = await WelfareCall.findById(callId);
    if (!call) {
      return res.status(200).send('ok');
    }

    const terminalFailures = ['busy', 'failed', 'no-answer', 'canceled'];
    if (terminalFailures.includes(callStatus) && call.status !== 'answered') {
      call.status = 'missed';
      await call.save();
      await updateGuardAlertnessScore(call.guardId);
    }

    return res.status(200).send('ok');
  } catch (error) {
    console.error('Twilio status webhook error:', error);
    return res.status(200).send('ok');
  }
};
