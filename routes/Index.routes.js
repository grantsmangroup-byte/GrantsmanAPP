/**
 * NEW ROUTES — add these imports and app.use() calls to server.js
 *
 * All routes assume authenticate + enforceAgencyScope have been applied
 * where appropriate (see each router file for specifics).
 */

const express = require('express');

// ── Controllers ────────────────────────────────────────────────────────────────
const incidentCtrl   = require('../controllers/incident.controller');
const patrolCtrl     = require('../controllers/patrol.controller');
const messageCtrl    = require('../controllers/message.controller');
const billingCtrl    = require('../controllers/billing.controller');
const scheduleCtrl   = require('../controllers/schedule.controller');
const clientCtrl     = require('../controllers/client.controller');
const payrollCtrl    = require('../controllers/payroll.controller');
const superCtrl      = require('../controllers/superadmin.controller');
const alertCtrl      = require('../controllers/alert.controller');
const gatelog        = require('../models/GateLog');
const pushCtrl       = require('../controllers/pushToken.controller');
const webhookSvc     = require('../services/webhook.service');
const auditSvc       = require('../services/audit.service');

// ── Middleware ─────────────────────────────────────────────────────────────────
const { authenticate, authorize, authenticateClient, enforceAgencyScope } = require('../middleware/auth.middleware');
const { agencyRateLimit, pingRateLimit, injectScopedQuery } = require('../middleware/tenancy.middleware');

const agencyAuth   = [authenticate, enforceAgencyScope, injectScopedQuery, agencyRateLimit];
const guardAuth    = [authenticate, authorize('guard')];
const adminAuth    = [authenticate, authorize('agency-admin'), enforceAgencyScope];
const superAuth    = [authenticate, authorize('super-admin')];
const adminOrSuper = [authenticate, authorize('agency-admin', 'supervisor'), enforceAgencyScope];

// ──────────────────────────────────────────────────────────────────────────────
// INCIDENTS
// ──────────────────────────────────────────────────────────────────────────────
const incidentRouter = express.Router();
incidentRouter.post('/',           ...guardAuth, incidentCtrl.createIncident);
incidentRouter.get('/mine',        ...guardAuth, incidentCtrl.getGuardIncidents);
incidentRouter.get('/',            ...adminOrSuper, incidentCtrl.listIncidents);
incidentRouter.get('/:id',         ...adminOrSuper, incidentCtrl.getIncident);
incidentRouter.patch('/:id/resolve',     ...adminOrSuper, incidentCtrl.resolveIncident);
incidentRouter.patch('/:id/visibility',  ...adminAuth, incidentCtrl.setClientVisibility);

// ──────────────────────────────────────────────────────────────────────────────
// PATROL
// ──────────────────────────────────────────────────────────────────────────────
const patrolRouter = express.Router();
patrolRouter.post('/checkpoints',              ...adminAuth, patrolCtrl.createCheckpoint);
patrolRouter.get('/checkpoints/:siteId',       ...agencyAuth, patrolCtrl.listCheckpoints);
patrolRouter.post('/scan',                     ...guardAuth, patrolCtrl.scanCheckpoint);
patrolRouter.get('/report',                    ...adminOrSuper, patrolCtrl.getPatrolReport);

// ──────────────────────────────────────────────────────────────────────────────
// MESSAGING
// ──────────────────────────────────────────────────────────────────────────────
const messageRouter = express.Router();
messageRouter.post('/',                   ...agencyAuth, messageCtrl.sendMessage);
messageRouter.get('/threads',             ...agencyAuth, messageCtrl.listThreads);
messageRouter.get('/thread/:userId',      ...agencyAuth, messageCtrl.getThread);
messageRouter.get('/unread-count',        ...agencyAuth, messageCtrl.unreadCount);

// ──────────────────────────────────────────────────────────────────────────────
// BILLING
// ──────────────────────────────────────────────────────────────────────────────
const billingRouter = express.Router();
billingRouter.get('/plans',         billingCtrl.getPlans);  // public
billingRouter.get('/subscription',  ...adminAuth, billingCtrl.getSubscription);
billingRouter.post('/subscribe',    ...adminAuth, billingCtrl.createCheckoutSession);
billingRouter.post('/portal',       ...adminAuth, billingCtrl.createPortalSession);
billingRouter.get('/invoices',      ...adminAuth, billingCtrl.getInvoices);
// Raw body required for Stripe signature verification — mount before express.json()
billingRouter.post('/webhook',      express.raw({ type: 'application/json' }), billingCtrl.stripeWebhook);

// ──────────────────────────────────────────────────────────────────────────────
// SCHEDULE
// ──────────────────────────────────────────────────────────────────────────────
const scheduleRouter = express.Router();
scheduleRouter.post('/',           ...adminOrSuper, scheduleCtrl.createShifts);
scheduleRouter.get('/',            ...adminOrSuper, scheduleCtrl.getWeekRoster);
scheduleRouter.delete('/:id',      ...adminOrSuper, scheduleCtrl.cancelShift);
scheduleRouter.post('/:id/swap',   ...adminOrSuper, scheduleCtrl.requestSwap);
scheduleRouter.get('/mine',        ...guardAuth, scheduleCtrl.getGuardSchedule);

// ──────────────────────────────────────────────────────────────────────────────
// CLIENT PORTAL
// ──────────────────────────────────────────────────────────────────────────────
const clientRouter = express.Router();
clientRouter.get('/overview',                   authenticateClient, clientCtrl.getOverview);
clientRouter.get('/sites/:siteId/guards',        authenticateClient, clientCtrl.getSiteGuards);
clientRouter.get('/sites/:siteId/incidents',     authenticateClient, clientCtrl.getSiteIncidents);
clientRouter.get('/sites/:siteId/activity',      authenticateClient, clientCtrl.getSiteActivity);

// ──────────────────────────────────────────────────────────────────────────────
// PAYROLL
// ──────────────────────────────────────────────────────────────────────────────
const payrollRouter = express.Router();
payrollRouter.get('/',  ...adminAuth, payrollCtrl.getPayrollSummary);

// ──────────────────────────────────────────────────────────────────────────────
// SUPERADMIN
// ──────────────────────────────────────────────────────────────────────────────
const superRouter = express.Router();
superRouter.get('/agencies',             ...superAuth, superCtrl.listAgencies);
superRouter.post('/agencies',            ...superAuth, superCtrl.createAgency);
superRouter.patch('/agencies/:id/status',...superAuth, superCtrl.setAgencyStatus);
superRouter.post('/agencies/:id/impersonate', ...superAuth, superCtrl.impersonateAgency);
superRouter.get('/metrics',              ...superAuth, superCtrl.getPlatformMetrics);

// ──────────────────────────────────────────────────────────────────────────────
// ALERTS
// ──────────────────────────────────────────────────────────────────────────────
const alertRouter = express.Router();
alertRouter.get('/',              ...adminOrSuper, alertCtrl.getAlertFeed);
alertRouter.get('/late-clockins', ...adminOrSuper, alertCtrl.getLateClockIns);

// ──────────────────────────────────────────────────────────────────────────────
// GATE LOGS (visitors + vehicles)
// ──────────────────────────────────────────────────────────────────────────────
const gateRouter = express.Router();
gateRouter.post('/visitors',          ...guardAuth, gatelog.logVisitorEntry);
gateRouter.patch('/visitors/:id/exit',...guardAuth, gatelog.logVisitorExit);
gateRouter.get('/visitors',           ...adminOrSuper, gatelog.listVisitors);
gateRouter.post('/vehicles',          ...guardAuth, gatelog.logVehicleEntry);
gateRouter.patch('/vehicles/:id/exit',...guardAuth, gatelog.logVehicleExit);
gateRouter.get('/vehicles',           ...adminOrSuper, gatelog.listVehicles);

// ──────────────────────────────────────────────────────────────────────────────
// WEBHOOKS
// ──────────────────────────────────────────────────────────────────────────────
const webhookRouter = express.Router();
webhookRouter.post('/',            ...adminAuth, webhookSvc.createEndpoint);
webhookRouter.get('/',             ...adminAuth, webhookSvc.listEndpoints);
webhookRouter.delete('/:id',       ...adminAuth, webhookSvc.deleteEndpoint);
webhookRouter.get('/:id/deliveries',...adminAuth, webhookSvc.getDeliveries);

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT LOG
// ──────────────────────────────────────────────────────────────────────────────
const auditRouter = express.Router();
auditRouter.get('/', ...adminAuth, async (req, res) => {
  try {
    const result = await auditSvc.query({ agencyId: req.agencyId, ...req.query });
    return res.json({ success: true, data: result });
  } catch {
    return res.status(500).json({ success: false, error: { message: 'Failed to load audit logs' } });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// PUSH TOKEN
// ──────────────────────────────────────────────────────────────────────────────
const pushRouter = express.Router();
pushRouter.patch('/',    ...guardAuth, pushCtrl.registerPushToken);
pushRouter.delete('/',   ...guardAuth, pushCtrl.removePushToken);

// ──────────────────────────────────────────────────────────────────────────────
// Export all routers — mount them in server.js
// ──────────────────────────────────────────────────────────────────────────────
module.exports = {
  incidentRouter,
  patrolRouter,
  messageRouter,
  billingRouter,
  scheduleRouter,
  clientRouter,
  payrollRouter,
  superRouter,
  alertRouter,
  gateRouter,
  webhookRouter,
  auditRouter,
  pushRouter,
};