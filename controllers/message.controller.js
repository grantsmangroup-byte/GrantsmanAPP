const Message  = require('../models/Message');
const User     = require('../models/User');
const pushSvc  = require('../services/push.service');

// ── POST /api/messages  ───────────────────────────────────────────────────────
exports.sendMessage = async (req, res) => {
  try {
    const { recipientId, body, refType, refId } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({ success: false, error: { message: 'Message body required' } });
    }

    const recipient = await User.findById(recipientId);
    if (!recipient || String(recipient.agencyId) !== String(req.agencyId)) {
      return res.status(404).json({ success: false, error: { message: 'Recipient not found' } });
    }

    const threadId = Message.threadIdFor(req.userId, recipientId);

    const message = await Message.create({
      agencyId:    req.agencyId,
      threadId,
      senderId:    req.userId,
      recipientId,
      body:        body.trim(),
      refType:     refType || null,
      refId:       refId   || null,
    });

    // Real-time delivery via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.to(`user-${recipientId}`).emit('new-message', {
        messageId: message._id,
        threadId,
        senderId:  req.userId,
        body:      message.body,
        createdAt: message.createdAt,
      });
    }

    // Push notification
    if (recipient.pushToken) {
      const sender = await User.findById(req.userId).select('fullName');
      await pushSvc.notifyMessage(
        recipient.pushToken,
        sender?.fullName || 'Team member',
        body.length > 60 ? body.slice(0, 57) + '…' : body
      );
    }

    return res.status(201).json({ success: true, data: message });
  } catch (err) {
    console.error('sendMessage:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to send message' } });
  }
};

// ── GET /api/messages/threads  — list all threads for current user ────────────
exports.listThreads = async (req, res) => {
  try {
    // Get the latest message per thread involving this user
    const threads = await Message.aggregate([
      {
        $match: {
          agencyId: req.agencyId,
          $or: [{ senderId: req.userId }, { recipientId: req.userId }],
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id:        '$threadId',
          lastMsg:    { $first: '$$ROOT' },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ['$recipientId', req.userId] }, { $eq: ['$readAt', null] }] },
                1, 0,
              ],
            },
          },
        },
      },
      { $sort: { 'lastMsg.createdAt': -1 } },
      { $limit: 50 },
    ]);

    // Populate the "other user" in each thread
    const populated = await Promise.all(
      threads.map(async (t) => {
        const otherId =
          String(t.lastMsg.senderId) === String(req.userId)
            ? t.lastMsg.recipientId
            : t.lastMsg.senderId;
        const other = await User.findById(otherId).select('fullName role');
        return { threadId: t._id, other, lastMessage: t.lastMsg, unreadCount: t.unreadCount };
      })
    );

    return res.json({ success: true, data: populated });
  } catch (err) {
    console.error('listThreads:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load threads' } });
  }
};

// ── GET /api/messages/thread/:userId  — messages in one thread ───────────────
exports.getThread = async (req, res) => {
  try {
    const { userId: otherUserId } = req.params;
    const { page = 1, limit = 40 } = req.query;
    const threadId = Message.threadIdFor(req.userId, otherUserId);

    const messages = await Message.find({ threadId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Mark unread messages as read
    await Message.updateMany(
      { threadId, recipientId: req.userId, readAt: null },
      { readAt: new Date() }
    );

    return res.json({ success: true, data: messages.reverse() });
  } catch (err) {
    console.error('getThread:', err);
    return res.status(500).json({ success: false, error: { message: 'Failed to load thread' } });
  }
};

// ── GET /api/messages/unread-count ────────────────────────────────────────────
exports.unreadCount = async (req, res) => {
  try {
    const count = await Message.countDocuments({
      recipientId: req.userId,
      readAt:      null,
    });
    return res.json({ success: true, data: { count } });
  } catch (err) {
    return res.status(500).json({ success: false, error: { message: 'Failed to get unread count' } });
  }
};