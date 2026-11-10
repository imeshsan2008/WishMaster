const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/env.config');
const { createOAuthClient } = require('../config/google.config');
const { clearWhatsAppSession } = require('../services/whatsapp.service');

async function googleCallback(req, res) {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  const oAuth2Client = createOAuthClient();
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    fs.mkdirSync(path.dirname(PATHS.TOKEN), { recursive: true });
    fs.writeFileSync(PATHS.TOKEN, JSON.stringify(tokens, null, 2));

    res.redirect('/home?success=true');
  } catch (err) {
    console.error('❌ Error retrieving access token:', err.message);
    res.status(500).send('Error retrieving access token: ' + err.message);
  }
}

async function googleLogout(req, res) {
  try {
    if (fs.existsSync(PATHS.TOKEN)) fs.unlinkSync(PATHS.TOKEN);
    if (fs.existsSync(PATHS.CONTACTS_CACHE)) fs.unlinkSync(PATHS.CONTACTS_CACHE);
    res.json({ ok: true, message: 'Google session cleared' });
  } catch (e) {
    console.error('❌ Google logout failed:', e.message);
    res.status(500).json({ ok: false, error: 'Failed to delete Google token' });
  }
}

async function whatsappLogout(req, res) {
  try {
    clearWhatsAppSession();
    res.json({ ok: true, message: 'WhatsApp session cleared' });
  } catch (e) {
    console.error('❌ WhatsApp logout failed:', e.message);
    res.status(500).json({ ok: false, error: 'Failed to logout WhatsApp' });
  }
}

module.exports = {
  googleCallback,
  googleLogout,
  whatsappLogout
};

