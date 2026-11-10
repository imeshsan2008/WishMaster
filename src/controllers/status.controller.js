const fs = require('fs');
const path = require('path');
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

async function exportWhatsAppSession(req, res) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    const waDir = PATHS.WA_AUTH_DIR;

    if (!fs.existsSync(waDir)) {
      return res.status(404).json({ error: 'No WhatsApp auth folder found.' });
    }

    const files = fs.readdirSync(waDir);
    if (!files || files.length === 0) {
      return res.status(404).json({ error: 'WhatsApp auth directory is empty.' });
    }

    for (const f of files) {
      const fullPath = path.join(waDir, f);
      try {
        if (fs.statSync(fullPath).isFile()) {
          zip.addLocalFile(fullPath, 'whatsapp_auth');
        }
      } catch (e) {}
    }

    const zipBuffer = zip.toBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="whatsapp_session.zip"');
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (err) {
    console.error('❌ Error exporting WhatsApp session:', err.message);
    res.status(500).json({ error: 'Failed to export WhatsApp session: ' + err.message });
  }
}

async function exportWhatsAppCreds(req, res) {
  try {
    const credsPath = path.join(PATHS.WA_AUTH_DIR, 'creds.json');
    if (!fs.existsSync(credsPath)) {
      return res.status(404).json({ error: 'creds.json not found in whatsapp_auth directory.' });
    }

    res.download(credsPath, 'creds.json');
  } catch (err) {
    console.error('❌ Error exporting creds.json:', err.message);
    res.status(500).json({ error: 'Failed to export creds.json: ' + err.message });
  }
}

async function importWhatsAppSession(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ success: false, error: 'No session file uploaded.' });
    }

    const originalName = (req.file.originalname || '').toLowerCase();
    const waDir = PATHS.WA_AUTH_DIR;
    fs.mkdirSync(waDir, { recursive: true });

    let credsFound = false;

    if (originalName.endsWith('.zip')) {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(req.file.buffer);
      const entries = zip.getEntries();

      if (!entries || entries.length === 0) {
        return res.status(400).json({ success: false, error: 'Uploaded zip archive is empty.' });
      }

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const baseName = path.basename(entry.entryName);
        if (!baseName) continue;

        const destPath = path.join(waDir, baseName);
        fs.writeFileSync(destPath, entry.getData());

        if (baseName === 'creds.json') {
          credsFound = true;
        }
      }
    } else if (originalName.endsWith('.json')) {
      try {
        JSON.parse(req.file.buffer.toString('utf8'));
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid JSON file: ' + e.message });
      }

      fs.writeFileSync(path.join(waDir, 'creds.json'), req.file.buffer);
      credsFound = true;
    } else {
      return res.status(400).json({ success: false, error: 'Only .zip or .json session files are supported.' });
    }

    if (!credsFound && !fs.existsSync(path.join(waDir, 'creds.json'))) {
      return res.status(400).json({ success: false, error: 'No creds.json found in the uploaded file.' });
    }

    console.log('🔄 WhatsApp session imported successfully. Restarting WhatsApp bot...');

    // Reconnect WhatsApp with new session cleanly
    const { restartWhatsAppBot } = require('../services/whatsapp.service');
    setTimeout(() => {
      restartWhatsAppBot().catch(err => {
        console.error('⚠️ Error restarting WhatsApp after import:', err.message);
      });
    }, 500);

    res.json({
      success: true,
      message: 'WhatsApp session imported successfully! Bot is reconnecting...'
    });
  } catch (err) {
    console.error('❌ Error importing WhatsApp session:', err.message);
    res.status(500).json({ success: false, error: 'Failed to import session: ' + err.message });
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
  cronTriggerHandler,
  exportWhatsAppSession,
  exportWhatsAppCreds,
  importWhatsAppSession
};
