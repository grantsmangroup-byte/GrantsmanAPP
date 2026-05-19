/**
 * Push Notification Service
 * Wraps Expo's push API and falls back gracefully when tokens are absent.
 * Install: npm install expo-server-sdk
 */

const { Expo } = require('expo-server-sdk');
const expo     = new Expo();

// ── Send to one or many Expo push tokens ──────────────────────────────────────
async function sendPushNotifications(notifications) {
  // notifications = [{ token, title, body, data, sound, badge }]
  const messages = [];

  for (const n of notifications) {
    if (!n.token || !Expo.isExpoPushToken(n.token)) {
      console.warn(`[Push] Invalid or missing token: ${n.token}`);
      continue;
    }
    messages.push({
      to:    n.token,
      sound: n.sound   || 'default',
      title: n.title,
      body:  n.body,
      data:  n.data    || {},
      badge: n.badge   || 1,
      priority: n.priority || 'high',
    });
  }

  if (!messages.length) return [];

  const chunks  = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error('[Push] Chunk send error:', err);
    }
  }

  return tickets;
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

exports.notifyWelfareCheck = async (guard) => {
  if (!guard.pushToken) return;
  return sendPushNotifications([{
    token: guard.pushToken,
    title: '📞 Welfare Check',
    body:  'Tap to confirm you are alert and safe.',
    data:  { type: 'WELFARE_CHECK', guardId: String(guard._id) },
    sound: 'default',
  }]);
};

exports.notifySOSReceived = async (supervisorTokens, guardName, siteName) => {
  const notifications = supervisorTokens.map((token) => ({
    token,
    title:    '🚨 SOS Alert',
    body:     `${guardName} triggered emergency at ${siteName}`,
    data:     { type: 'SOS_ALERT' },
    sound:    'default',
    priority: 'high',
  }));
  return sendPushNotifications(notifications);
};

exports.notifyIncidentReported = async (supervisorTokens, severity, siteName) => {
  const emoji = severity === 'critical' ? '🔴' : severity === 'high' ? '🟠' : '🟡';
  const notifications = supervisorTokens.map((token) => ({
    token,
    title: `${emoji} New Incident — ${severity.toUpperCase()}`,
    body:  `Reported at ${siteName}`,
    data:  { type: 'INCIDENT', severity },
    sound: 'default',
  }));
  return sendPushNotifications(notifications);
};

exports.notifyShiftReminder = async (guard, message) => {
  if (!guard.pushToken) return;
  return sendPushNotifications([{
    token: guard.pushToken,
    title: '⏰ Shift Reminder',
    body:  message,
    data:  { type: 'SHIFT_REMINDER' },
  }]);
};

exports.notifyMessage = async (recipientToken, senderName, preview) => {
  if (!recipientToken) return;
  return sendPushNotifications([{
    token: recipientToken,
    title: `💬 ${senderName}`,
    body:  preview,
    data:  { type: 'MESSAGE' },
  }]);
};

exports.sendPushNotifications = sendPushNotifications;