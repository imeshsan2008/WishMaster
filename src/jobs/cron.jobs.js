const cron = require('node-cron');
const { getSocket } = require('../services/whatsapp.service');
const {
  setBirthdaysSentToday,
  sendTodaysBirthdays,
  getBirthdaysSentToday,
  clearOldRetries
} = require('../services/birthday.service');
const { syncGoogleContactsRealtime } = require('../services/google.service');
const { ADMIN_GROUP_JID } = require('../config/env.config');

function initCronJobs(io = null) {
  // 1. Real-time Google Contacts Background Sync (Every 2 minutes)
  cron.schedule('*/2 * * * *', async () => {
    try {
      await syncGoogleContactsRealtime(io);
    } catch (e) {}
  });

  // Initial real-time sync 5s after server boot
  setTimeout(async () => {
    try {
      console.log('🔄 Triggering initial Google Contacts real-time sync...');
      await syncGoogleContactsRealtime(io);
    } catch (e) {}
  }, 5000);

  // 2. Reset birthday flag and clean expired retries daily before midnight (23:55 Asia/Colombo)
  cron.schedule(
    '55 23 * * *',
    () => {
      console.log('⏰ [CRON] Resetting daily birthdaysSentToday flag & cleaning expired retries');
      setBirthdaysSentToday(false);
      clearOldRetries();
    },
    { scheduled: true, timezone: 'Asia/Colombo' }
  );

  // 3. Automatic Midnight birthday greetings at 12:00 AM (00:00 Asia/Colombo)
  cron.schedule(
    '0 0 * * *',
    async () => {
      console.log('⏰ [CRON] Running automatic 12:00 AM Midnight birthday check...');
      const sock = getSocket();
      if (!sock) {
        console.warn('⚠️ [CRON] WhatsApp bot not connected, skipping midnight birthday send');
        return;
      }

      try {
        if (ADMIN_GROUP_JID) {
          await sock.sendMessage(ADMIN_GROUP_JID, {
            text: '⏰ [CRON] 12:00 AM Midnight: Checking and dispatching today’s birthday wishes...'
          }).catch(() => {});
        }
        await sendTodaysBirthdays(sock, ADMIN_GROUP_JID);
      } catch (err) {
        console.error('❌ [CRON] Error during midnight birthday send:', err.message || err);
      }
    },
    { scheduled: true, timezone: 'Asia/Colombo' }
  );

  // 4. Automatic morning birthday greetings follow-up at 08:00 AM Asia/Colombo
  cron.schedule(
    '0 8 * * *',
    async () => {
      console.log('⏰ [CRON] Running automatic morning birthday check...');
      const sock = getSocket();
      if (!sock) {
        console.warn('⚠️ [CRON] WhatsApp bot not connected, skipping automated birthday send');
        return;
      }

      if (getBirthdaysSentToday()) {
        console.log('ℹ️ [CRON] Birthdays already sent today');
        return;
      }

      try {
        if (ADMIN_GROUP_JID) {
          await sock.sendMessage(ADMIN_GROUP_JID, {
            text: '⏰ [CRON] Checking today’s birthdays automatically...'
          }).catch(() => {});
        }
        await sendTodaysBirthdays(sock, ADMIN_GROUP_JID);
      } catch (err) {
        console.error('❌ [CRON] Error during automated birthday send:', err.message || err);
      }
    },
    { scheduled: true, timezone: 'Asia/Colombo' }
  );

  // 5. Periodic Catch-up Job (Every 15 minutes)
  // Guarantees that if the server was asleep or off at 12:00 AM midnight, as soon as it powers on,
  // it checks for unsent birthdays for today and dispatches them without duplicates.
  cron.schedule(
    '*/15 * * * *',
    async () => {
      const sock = getSocket();
      if (!sock) return;
      try {
        const { checkAndCatchUpTodaysBirthdays } = require('../services/birthday.service');
        await checkAndCatchUpTodaysBirthdays(sock);
      } catch (err) {
        console.warn('⚠️ [CRON] Catch-up error:', err.message);
      }
    },
    { scheduled: true, timezone: 'Asia/Colombo' }
  );

  // Boot Catch-up Check (20 seconds after boot)
  setTimeout(async () => {
    const sock = getSocket();
    if (sock) {
      try {
        const { checkAndCatchUpTodaysBirthdays } = require('../services/birthday.service');
        await checkAndCatchUpTodaysBirthdays(sock);
      } catch (e) {}
    }
  }, 20000);

  console.log('✅ Cron jobs initialized (Midnight at 00:00, Reset at 23:55, 15m Catch-up active)');
}

module.exports = {
  initCronJobs
};
