const fs = require('fs');
const path = require('path');
const { PATHS, GOOGLE_SCOPES } = require('../config/env.config');
const { createOAuthClientAsync, saveTokenAsync, clearGoogleTokenAsync } = require('../config/google.config');
const { clearWhatsAppSession } = require('../services/whatsapp.service');

async function googleLogin(req, res) {
  try {
    const oAuth2Client = await createOAuthClientAsync();
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      prompt: 'consent'
    });
    res.redirect(authUrl);
  } catch (err) {
    console.error('❌ Google login initiation failed:', err.message);
    res.status(500).send('Error initiating Google login: ' + err.message);
  }
}

async function googleCallback(req, res) {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send('Authorization code missing');
  }

  try {
    const oAuth2Client = await createOAuthClientAsync();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    await saveTokenAsync(tokens);

    res.redirect('/home?success=true');
  } catch (err) {
    console.error('❌ Error retrieving access token:', err.message);
    res.status(500).send('Error retrieving access token: ' + err.message);
  }
}

async function googleLogout(req, res) {
  try {
    await clearGoogleTokenAsync();
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
  googleLogin,
  googleCallback,
  googleLogout,
  whatsappLogout
};

