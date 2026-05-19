const mongoose = require('mongoose');
const crypto   = require('crypto');
const axios    = require('axios');

// ── WebhookEndpoint: configured per agency ────────────────────────────────────
const webhookEndpointSchema = new mongoose.Schema({
  agencyId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true },
  url:         { type: String, required: true },
  secret:      { type: String, required: true },   // HMAC signing secret
  events:      [String],                            // [] = all events
  isActive:    { type: Boolean, default: true },
  description: String,
  createdAt:   { type: Date, default: Date.now },
});

const WebhookEndpoint = mongoose.model('WebhookEndpoint', webhookEndpointSchema);

// ── Delivery log ──────────────────────────────────────────────────────────────
const webhookDeliverySchema = new mongoose.Schema({
  endpointId:  { type: mongoose.Schema.Types.ObjectId, ref: 'WebhookEndpoint' },
  event:       String,
  payload:     mongoose.Schema.Types.Mixed,
  statusCode:  Number,
  success:     Boolean,
  attempts:    { type: Number, default: 1 },
  responseMs:  Number,
  error:       String,
  deliveredAt: { type: Date, default: Date.now },
});

const WebhookDelivery = mongoose.model('WebhookDelivery', webhookDeliverySchema);

// ── Dispatch event to all matching endpoints for an agency ────────────────────
async function dispatch(agencyId, event, data) {
  const endpoints = await WebhookEndpoint.find({
    agencyId,
    isActive: true,
    $or: [{ events: { $size: 0 } }, { events: event }],
  });

  for (const ep of endpoints) {
    const payload = { event, data, timestamp: new Date().toISOString() };
    const body    = JSON.stringify(payload);
    const sig     = crypto.createHmac('sha256', ep.secret).update(body).digest('hex');

    const start = Date.now();
    let statusCode, success, error;

    try {
      const resp = await axios.post(ep.url, payload, {
        headers: {
          'Content-Type':             'application/json',
          'X-Grantsman-Signature':    `sha256=${sig}`,
          'X-Grantsman-Event':        event,
        },
        timeout: 10000,
      });
      statusCode = resp.status;
      success    = resp.status >= 200 && resp.status < 300;
    } catch (err) {
      statusCode = err.response?.status || 0;
      success    = false;
      error      = err.message;
    }

    // Fire-and-forget delivery log
    WebhookDelivery.create({
      endpointId: ep._id,
      event,
      payload,
      statusCode,
      success,
      responseMs: Date.now() - start,
      error,
    }).catch(() => {});
  }
}

// ── Supported events ──────────────────────────────────────────────────────────
const EVENTS = {
  SOS_TRIGGERED:      'sos.triggered',
  SOS_RESOLVED:       'sos.resolved',
  WELFARE_MISSED:     'welfare.missed',
  INCIDENT_CREATED:   'incident.created',
  GUARD_CLOCKED_IN:   'guard.clocked_in',
  GUARD_CLOCKED_OUT:  'guard.clocked_out',
  GEOFENCE_BREACH:    'guard.geofence_breach',
};

// ── CRUD controller ───────────────────────────────────────────────────────────
const createEndpoint = async (req, res) => {
  try {
    const { url, events = [], description } = req.body;
    const secret = crypto.randomBytes(32).toString('hex');
    const ep = await WebhookEndpoint.create({ agencyId: req.agencyId, url, secret, events, description });
    return res.status(201).json({ success: true, data: { ...ep.toObject(), secret } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to create webhook' } });
  }
};

const listEndpoints = async (req, res) => {
  try {
    const eps = await WebhookEndpoint.find({ agencyId: req.agencyId }).select('-secret');
    return res.json({ success: true, data: eps });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to list webhooks' } });
  }
};

const deleteEndpoint = async (req, res) => {
  try {
    await WebhookEndpoint.findOneAndDelete({ _id: req.params.id, agencyId: req.agencyId });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to delete webhook' } });
  }
};

const getDeliveries = async (req, res) => {
  try {
    const deliveries = await WebhookDelivery.find({ endpointId: req.params.id })
      .sort({ deliveredAt: -1 })
      .limit(50);
    return res.json({ success: true, data: deliveries });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to load deliveries' } });
  }
};

module.exports = {
  WebhookEndpoint,
  WebhookDelivery,
  dispatch,
  EVENTS,
  createEndpoint,
  listEndpoints,
  deleteEndpoint,
  getDeliveries,
};