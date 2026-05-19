const AuditLog = require('../models/AuditLog');

/**
 * Record an audit event.
 * Call this from controllers after any meaningful mutation.
 *
 * @param {object} opts
 * @param {string} opts.action        - dot-namespaced action, e.g. 'guard.created'
 * @param {object} opts.req           - Express request (provides actor, agencyId, IP)
 * @param {string} [opts.entityType]  - Model name of the affected document
 * @param {*}      [opts.entityId]    - ObjectId of the affected document
 * @param {object} [opts.before]      - State snapshot before mutation
 * @param {object} [opts.after]       - State snapshot after mutation
 */
async function log({ action, req, entityType, entityId, before, after }) {
  try {
    await AuditLog.create({
      agencyId:   req.agencyId,
      actorId:    req.userId,
      actorRole:  req.userRole,
      action,
      entityType,
      entityId,
      before,
      after,
      ip:         req.ip || req.headers['x-forwarded-for'],
      userAgent:  req.headers['user-agent'],
    });
  } catch (err) {
    // Never let audit failures break the main flow
    console.error('[Audit] Failed to write log:', err.message);
  }
}

/**
 * Query audit logs with filters.
 */
async function query({ agencyId, actorId, action, entityType, entityId, from, to, page = 1, limit = 50 }) {
  const filter = {};
  if (agencyId)   filter.agencyId   = agencyId;
  if (actorId)    filter.actorId    = actorId;
  if (action)     filter.action     = { $regex: action, $options: 'i' };
  if (entityType) filter.entityType = entityType;
  if (entityId)   filter.entityId   = entityId;
  if (from || to) {
    filter.timestamp = {};
    if (from) filter.timestamp.$gte = new Date(from);
    if (to)   filter.timestamp.$lte = new Date(to);
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate('actorId', 'fullName email role')
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit)),
    AuditLog.countDocuments(filter),
  ]);

  return { logs, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / limit) };
}

module.exports = { log, query };