// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
let _stripe = null;
const getStripe = () => {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
    }
    _stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
};
const { Plan, Subscription, Invoice } = require('../models/Billing');
const Agency = require('../models/Agency');
const audit  = require('../services/audit.service');

// ── GET /api/billing/plans ────────────────────────────────────────────────────
exports.getPlans = async (req, res) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort('monthlyPriceCents');
    return res.json({ success: true, data: plans });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch plans' } });
  }
};

// ── GET /api/billing/subscription ────────────────────────────────────────────
exports.getSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findOne({ agencyId: req.agencyId })
      .populate('planId');
    return res.json({ success: true, data: sub || null });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch subscription' } });
  }
};

// ── POST /api/billing/subscribe ──────────────────────────────────────────────
// Creates a Stripe checkout session; agency completes payment on Stripe hosted page
exports.createCheckoutSession = async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = await Plan.findById(planId);
    if (!plan?.stripePriceId) {
      return res.status(400).json({ success: false, error: { message: 'Invalid plan' } });
    }

    const agency = await Agency.findById(req.agencyId);

    // Ensure Stripe customer exists
    let sub = await Subscription.findOne({ agencyId: req.agencyId });
    let customerId = sub?.stripeCustomerId;

    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: agency.email,
        name:  agency.name,
        metadata: { agencyId: String(req.agencyId) },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer:   customerId,
      mode:       'subscription',
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${process.env.WEB_APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.WEB_APP_URL}/billing`,
      metadata:    { agencyId: String(req.agencyId), planId: String(planId) },
      subscription_data: {
        trial_period_days: 14,
        metadata: { agencyId: String(req.agencyId) },
      },
    });

    return res.json({ success: true, data: { url: session.url } });
  } catch (err) {
    console.error('createCheckoutSession:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to create checkout session' } });
  }
};

// ── POST /api/billing/portal ─────────────────────────────────────────────────
// Stripe customer portal — manage payment method, cancel, upgrade
exports.createPortalSession = async (req, res) => {
  try {
    const sub = await Subscription.findOne({ agencyId: req.agencyId });
    if (!sub?.stripeCustomerId) {
      return res.status(400).json({ success: false, error: { message: 'No active subscription' } });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   sub.stripeCustomerId,
      return_url: `${process.env.WEB_APP_URL}/billing`,
    });

    return res.json({ success: true, data: { url: session.url } });
  } catch (err) {
    console.error('createPortalSession:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to open billing portal' } });
  }
};

// ── GET /api/billing/invoices ────────────────────────────────────────────────
exports.getInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find({ agencyId: req.agencyId })
      .sort({ createdAt: -1 })
      .limit(24);
    return res.json({ success: true, data: invoices });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to fetch invoices' } });
  }
};

// ── POST /api/billing/webhook  (Stripe → backend, no auth) ───────────────────
exports.stripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session   = event.data.object;
        const agencyId  = session.metadata?.agencyId;
        const planId    = session.metadata?.planId;
        const stripeSub = await stripe.subscriptions.retrieve(session.subscription);

        await Subscription.findOneAndUpdate(
          { agencyId },
          {
            agencyId,
            planId,
            stripeCustomerId:     session.customer,
            stripeSubscriptionId: session.subscription,
            status:               stripeSub.status,
            currentPeriodStart:   new Date(stripeSub.current_period_start * 1000),
            currentPeriodEnd:     new Date(stripeSub.current_period_end   * 1000),
            trialEndsAt:          stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null,
            updatedAt:            new Date(),
          },
          { upsert: true, new: true }
        );
        break;
      }

      case 'invoice.payment_succeeded': {
        const inv = event.data.object;
        const agencyId = inv.subscription
          ? (await stripe.subscriptions.retrieve(inv.subscription)).metadata?.agencyId
          : null;

        if (agencyId) {
          await Invoice.findOneAndUpdate(
            { stripeInvoiceId: inv.id },
            {
              agencyId,
              stripeInvoiceId: inv.id,
              amountCents:     inv.amount_paid,
              currency:        inv.currency,
              status:          'paid',
              pdfUrl:          inv.invoice_pdf,
              paidAt:          new Date(inv.status_transitions.paid_at * 1000),
              periodStart:     new Date(inv.period_start * 1000),
              periodEnd:       new Date(inv.period_end   * 1000),
            },
            { upsert: true }
          );
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        const agencyId  = stripeSub.metadata?.agencyId;
        if (agencyId) {
          await Subscription.findOneAndUpdate(
            { agencyId },
            {
              status:             stripeSub.status,
              currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
              currentPeriodEnd:   new Date(stripeSub.current_period_end   * 1000),
              cancelAtPeriodEnd:  stripeSub.cancel_at_period_end,
              updatedAt:          new Date(),
            }
          );
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('Stripe webhook handler error:', err);
  }

  return res.json({ received: true });
};