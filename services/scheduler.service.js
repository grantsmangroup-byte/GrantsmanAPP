const cron = require('node-cron');
const Guard = require('../models/Guard');
const WelfareCall = require('../models/WelfareCall');
const { triggerVoiceCall } = require('./communication.service');

/**
 * Check if guard is currently on shift
 */
function isOnShift(guard) {
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

  const shiftStart = guard.shiftStart || '00:00';
  const shiftEnd = guard.shiftEnd || '23:59';
  
  // Handle overnight shifts (e.g., 18:00 to 06:00)
  if (shiftStart > shiftEnd) {
    return currentTime >= shiftStart || currentTime <= shiftEnd;
  }
  
  return currentTime >= shiftStart && currentTime <= shiftEnd;
}

/**
 * Generate random interval between min and max minutes
 */
function getRandomInterval(min = 45, max = 90) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Schedule randomized welfare calls for all on-duty guards
 */
function startWelfareCallScheduler(io) {
  console.log('🕐 Welfare call scheduler started');

  // Run every 10 minutes to check for scheduled calls
  cron.schedule('*/10 * * * *', async () => {
    try {
      const guards = await Guard.find({
        status: 'on-duty',
        isActive: true
      }).populate('assignedSiteId');

      for (const guard of guards) {
        if (!isOnShift(guard)) continue;

        // Check if guard already has a pending call
        const pendingCall = await WelfareCall.findOne({
          guardId: guard._id,
          status: 'scheduled',
          scheduledAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) } // Within last 2 hours
        });

        if (pendingCall) continue;

        // Check last welfare call
        const lastCall = await WelfareCall.findOne({
          guardId: guard._id
        }).sort({ scheduledAt: -1 });

        const shouldSchedule = !lastCall || 
          (Date.now() - lastCall.scheduledAt.getTime()) > 45 * 60 * 1000; // 45 min

        if (shouldSchedule) {
          const welfareCall = new WelfareCall({
            agencyId: guard.agencyId,
            guardId: guard._id,
            siteId: guard.assignedSiteId,
            scheduledAt: new Date(),
            status: 'scheduled'
          });

          await welfareCall.save();

          await triggerVoiceCall(guard.phone, welfareCall._id);

          if (io) {
            io.to(`guard-${guard._id}`).emit('welfare-check', {
              callId: welfareCall._id,
              scheduledAt: welfareCall.scheduledAt,
              guardId: guard._id,
            });

            io.to(`agency-${guard.agencyId}`).emit('welfare-check-created', {
              callId: welfareCall._id,
              guardId: guard._id,
              guardName: guard.name,
              scheduledAt: welfareCall.scheduledAt,
            });
          }

          console.log(`📞 Scheduled welfare call for ${guard.name}`);
        }
      }
    } catch (error) {
      console.error('Error in welfare call scheduler:', error.message);
    }
  });
}

module.exports = {
  startWelfareCallScheduler
};