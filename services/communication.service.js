let twilioLib = null;

try {
  // eslint-disable-next-line global-require
  twilioLib = require('twilio');
} catch (error) {
  twilioLib = null;
}

const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!twilioLib || !accountSid || !authToken) {
    return null;
  }

  return twilioLib(accountSid, authToken);
};

const getWebhookBaseUrl = () => (
  process.env.TWILIO_WEBHOOK_BASE_URL
  || process.env.PUBLIC_BASE_URL
  || process.env.API_BASE_URL
  || ''
).replace(/\/$/, '');

exports.triggerVoiceCall = async (phoneNumber, welfareCallId) => {
  const client = getTwilioClient();
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const baseUrl = getWebhookBaseUrl();

  if (!client || !fromNumber || !baseUrl) {
    console.warn('⚠️  Twilio not fully configured. Skipping outbound voice call.');
    return null;
  }

  try {
    const voiceUrl = `${baseUrl}/api/welfare/twilio/voice?callId=${welfareCallId}`;
    const statusUrl = `${baseUrl}/api/welfare/twilio/status?callId=${welfareCallId}`;

    const call = await client.calls.create({
      to: phoneNumber,
      from: fromNumber,
      url: voiceUrl,
      method: 'POST',
      statusCallback: statusUrl,
      statusCallbackMethod: 'POST',
      statusCallbackEvent: ['completed', 'busy', 'failed', 'no-answer', 'canceled'],
    });

    console.log(`📞 Twilio call started for welfare check ${welfareCallId} (sid: ${call.sid})`);
    return call;
  } catch (error) {
    console.error('Twilio voice call error:', error.message);
    return null;
  }
};
