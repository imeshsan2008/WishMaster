const { HOSTNAME } = require('../config/env.config');

let heartbeatInterval = null;

/**
 * Initializes keep-alive heartbeat self-pinger.
 * Pings public HOSTNAME every 4 minutes to help prevent container idle timeout on free PaaS (Koyeb, Render).
 */
function initHeartbeat() {
  if (heartbeatInterval) return;

  const isLocalhost = HOSTNAME.includes('127.0.0.1') || HOSTNAME.includes('localhost');
  const targetUrl = `${HOSTNAME}/ping`;

  console.log(`💓 [Heartbeat] Initialized with target: ${targetUrl} (Every 4 minutes)`);

  heartbeatInterval = setInterval(async () => {
    try {
      if (isLocalhost) return; // Don't self-ping in local development

      const res = await fetch(targetUrl, {
        headers: { 'User-Agent': 'WishMaster-Heartbeat/4.0' }
      });
      if (res.ok) {
        console.log(`💓 [Heartbeat] Keep-alive ping OK (${new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Colombo' })})`);
      } else {
        console.warn(`⚠️ [Heartbeat] Ping responded with status ${res.status}`);
      }
    } catch (err) {
      console.warn(`⚠️ [Heartbeat] Ping error: ${err.message}`);
    }
  }, 4 * 60 * 1000); // 4 minutes
}

module.exports = {
  initHeartbeat
};

