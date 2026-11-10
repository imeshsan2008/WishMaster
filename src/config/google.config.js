const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { PATHS, GOOGLE_SCOPES, REDIRECT_URI } = require('./env.config');
const { safeReadJson, safeWriteJson } = require('../utils/file.util');

function loadCredentials() {
  if (!fs.existsSync(PATHS.CREDENTIALS)) {
    throw new Error(`Missing credentials.json at: ${PATHS.CREDENTIALS}`);
  }
  return JSON.parse(fs.readFileSync(PATHS.CREDENTIALS, 'utf8'));
}

function createOAuthClient() {
  const creds = loadCredentials();
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web || {};
  if (!client_id) {
    throw new Error('Invalid credentials.json format (missing client_id)');
  }
  return new google.auth.OAuth2(
    client_id,
    client_secret,
    (redirect_uris && redirect_uris[0]) || REDIRECT_URI
  );
}

async function getAuthClient(req, res) {
  const oAuth2Client = createOAuthClient();

  if (fs.existsSync(PATHS.TOKEN)) {
    const token = safeReadJson(PATHS.TOKEN, null);
    if (token) {
      oAuth2Client.setCredentials(token);

      // Auto-save refreshed tokens to token.json whenever Google refreshes in the background
      oAuth2Client.on('tokens', (newTokens) => {
        try {
          const current = safeReadJson(PATHS.TOKEN, {});
          const merged = { ...current, ...newTokens };
          safeWriteJson(PATHS.TOKEN, merged);
          console.log('🔄 Google OAuth token automatically refreshed & saved');
        } catch (e) {
          console.warn('⚠️ Could not save refreshed Google token:', e.message);
        }
      });

      // Proactively refresh if token has expired or is expiring within 5 minutes
      const isExpiring = token.expiry_date && (Date.now() >= token.expiry_date - (5 * 60 * 1000));
      if (isExpiring && token.refresh_token) {
        try {
          const { credentials } = await oAuth2Client.refreshAccessToken();
          const merged = { ...token, ...credentials };
          safeWriteJson(PATHS.TOKEN, merged);
          oAuth2Client.setCredentials(merged);
        } catch (refreshErr) {
          console.warn('⚠️ Token proactive refresh notice:', refreshErr.message);
        }
      }

      return oAuth2Client;
    }
  }

  if (res) {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_SCOPES,
      prompt: 'consent'
    });
    res.redirect(authUrl);
  }
  return null;
}

module.exports = {
  loadCredentials,
  createOAuthClient,
  getAuthClient
};

