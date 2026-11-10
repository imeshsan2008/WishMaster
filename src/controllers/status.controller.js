const fs = require('fs');
const qrcode = require('qrcode');
const { PATHS } = require('../config/env.config');
const {
  getSocket,
  getLatestQR,
  getPairingStatus: getBotPairingStatus,
  getLinkedNumber
} = require('../services/whatsapp.service');
const { getBirthdayLogs, clearOldRetries } = require('../services/birthday.service');
const { getFestiveLogs } = require('../services/festive.service');
const { isDbConnected } = require('../config/db');

async function getSystemStatus(req, res) {
  const sock = getSocket();
  const { loadTokenAsync } = require('../config/google.config');
  let googleLinked = fs.existsSync(PATHS.TOKEN);
  if (!googleLinked) {
    try {
      const token = await loadTokenAsync();
      googleLinked = !!token;
    } catch (e) {}
  }
  const rawId = sock?.user?.id || getLinkedNumber() || '';
  const cleanNumber = rawId.split('@')[0].split(':')[0].replace(/\D/g, '');

  res.json({
    google: { linked: googleLinked },
    whatsapp: {
      linked: !!sock,
      number: cleanNumber ? `+${cleanNumber}` : null,
      me: sock?.user?.name || null
    },
    database: {
      connected: isDbConnected()
    }
  });
}

async function getQrImage(req, res) {
  const latestQR = getLatestQR();
  if (!latestQR) {
    return res.status(404).send('No QR code available currently');
  }

  try {
    const dataUrl = await qrcode.toDataURL(latestQR, { errorCorrectionLevel: 'H' });
    const img = Buffer.from(dataUrl.split(',')[1], 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length
    });
    res.end(img);
  } catch (err) {
    console.error('❌ QR generation error:', err.message);
    res.status(500).send(err.message);
  }
}

function getPairingStatus(req, res) {
  const rawId = getLinkedNumber() || '';
  const cleanNumber = String(rawId).split('@')[0].split(':')[0].replace(/\D/g, '');
  res.json({
    status: getBotPairingStatus(),
    linked: cleanNumber ? `+${cleanNumber}` : null
  });
}

async function sendTestMessage(req, res) {
  const sock = getSocket();
  const linked = getLinkedNumber();

  if (!sock || !linked) {
    return res.json({ ok: false, message: 'WhatsApp is not connected or linked' });
  }

  try {
    const jid = `${linked}@s.whatsapp.net`;
    await sock.sendMessage(jid, {
      text: '✅ Successfully connected WishMaster Bot!'
    });
    res.json({ ok: true, message: 'Test message sent successfully!' });
  } catch (err) {
    console.error('❌ Failed to send test message:', err.message);
    res.json({ ok: false, message: 'Failed to send test message: ' + err.message });
  }
}

function getBirthdayLogsHandler(req, res) {
  res.json(getBirthdayLogs());
}

function getFestiveLogsHandler(req, res) {
  res.json(getFestiveLogs());
}

function clearRetriesHandler(req, res) {
  const removed = clearOldRetries();
  res.json({ removed });
}

function pingHandler(req, res) {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    timezone: 'Asia/Colombo',
    bot: getBotPairingStatus()
  });
}

async function cronTriggerHandler(req, res) {
  const secret = req.query.secret || req.headers['x-cron-secret'];
  const expectedSecret = process.env.CRON_SECRET || 'wishmaster_cron_2026';
  if (secret !== expectedSecret) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid cron secret' });
  }

  const sock = getSocket();
  const { sendTodaysBirthdays } = require('../services/birthday.service');
  const { ADMIN_GROUP_JID } = require('../config/env.config');

  try {
    console.log('⏰ [External Cron Trigger] Running birthday check on demand...');
    await sendTodaysBirthdays(sock, ADMIN_GROUP_JID);
    res.json({ success: true, message: 'Birthday check triggered successfully' });
  } catch (err) {
    console.error('❌ [External Cron Trigger] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getSystemStatus,
  getQrImage,
  getPairingStatus,
  sendTestMessage,
  getBirthdayLogsHandler,
  getFestiveLogsHandler,
  clearRetriesHandler,
  pingHandler,
  cronTriggerHandler
};
