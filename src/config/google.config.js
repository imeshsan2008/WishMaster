const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { PATHS, GOOGLE_SCOPES, REDIRECT_URI } = require('./env.config');
const { safeReadJson, safeWriteJson } = require('../utils/file.util');

let inMemoryCreds = null;
let inMemoryToken = null;

function setInMemoryCreds(creds) {
  inMemoryCreds = creds;
}

function setInMemoryToken(token) {
  inMemoryToken = token;
}

/**
 * Loads credentials from Environment, Disk, or Supabase memory cache.
 */
function loadCredentials() {
  if (inMemoryCreds) return inMemoryCreds;

  // 1. Check process.env.GOOGLE_CREDENTIALS_JSON
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
      inMemoryCreds = parsed;
      return parsed;
    } catch (e) {
      console.warn('⚠️ Invalid GOOGLE_CREDENTIALS_JSON in env:', e.message);
    }
  }

  // 2. Check process.env.GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    const creds = {
      web: {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uris: [process.env.REDIRECT_URI || REDIRECT_URI]
      }
    };
    inMemoryCreds = creds;
    return creds;
  }

  // 3. Check local disk file (files/credentials.json)
  if (fs.existsSync(PATHS.CREDENTIALS)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(PATHS.CREDENTIALS, 'utf8'));
      inMemoryCreds = parsed;
      return parsed;
    } catch (e) {
      console.warn('⚠️ Error parsing local credentials.json:', e.message);
    }
  }

  return null;
}

async function loadCredentialsAsync() {
  const syncCreds = loadCredentials();
  if (syncCreds) return syncCreds;

  // 4. Try loading from Supabase DB (admin_settings table)
  try {
    const { getSql, isDbConnected } = require('./db');
    const sql = getSql();
    if (isDbConnected() && sql) {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'google_credentials' LIMIT 1`;
      if (rows && rows[0] && rows[0].value) {
        const parsed = JSON.parse(rows[0].value);
        inMemoryCreds = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.warn('⚠️ Could not load Google credentials from DB:', e.message);
  }

  return null;
}

async function loadTokenAsync() {
  if (inMemoryToken) return inMemoryToken;

  // 1. Check local file (files/token.json)
  if (fs.existsSync(PATHS.TOKEN)) {
    const token = safeReadJson(PATHS.TOKEN, null);
    if (token) {
      inMemoryToken = token;
      return token;
    }
  }

  // 2. Check process.env.GOOGLE_TOKEN_JSON
  if (process.env.GOOGLE_TOKEN_JSON) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_TOKEN_JSON);
      inMemoryToken = parsed;
      return parsed;
    } catch (e) {}
  }

  // 3. Check Supabase DB (admin_settings table)
  try {
    const { getSql, isDbConnected } = require('./db');
    const sql = getSql();
    if (isDbConnected() && sql) {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'google_token' LIMIT 1`;
      if (rows && rows[0] && rows[0].value) {
        const parsed = JSON.parse(rows[0].value);
        inMemoryToken = parsed;
        return parsed;
      }
    }
  } catch (e) {
    console.warn('⚠️ Could not load Google token from DB:', e.message);
  }

  return null;
}

async function saveTokenAsync(token) {
  if (!token) return;
  inMemoryToken = token;

  // Save to local disk if directory exists or can be created
  try {
    fs.mkdirSync(path.dirname(PATHS.TOKEN), { recursive: true });
    safeWriteJson(PATHS.TOKEN, token);
  } catch (e) {}

  // Save to Supabase DB (admin_settings table)
  try {
    const { getSql, isDbConnected } = require('./db');
    const sql = getSql();
    if (isDbConnected() && sql) {
      const str = JSON.stringify(token);
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('google_token', ${str})
        ON CONFLICT (key) DO UPDATE SET value = ${str};
      `;
    }
  } catch (e) {
    console.warn('⚠️ Could not persist Google token to DB:', e.message);
  }
}

async function createOAuthClientAsync() {
  const creds = await loadCredentialsAsync();
  if (!creds) {
    throw new Error('Google credentials not configured (credentials.json or DB setting missing)');
  }

  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web || {};
  if (!client_id) {
    throw new Error('Invalid credentials format (missing client_id)');
  }

  const configuredRedirectUri = (redirect_uris && redirect_uris[0]) || process.env.REDIRECT_URI || REDIRECT_URI;
  return new google.auth.OAuth2(client_id, client_secret, configuredRedirectUri);
}

function createOAuthClient() {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error('Google credentials not configured');
  }

  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web || {};
  const configuredRedirectUri = (redirect_uris && redirect_uris[0]) || process.env.REDIRECT_URI || REDIRECT_URI;
  return new google.auth.OAuth2(client_id, client_secret, configuredRedirectUri);
}

async function getAuthClient(req, res) {
  let oAuth2Client = null;
  try {
    oAuth2Client = await createOAuthClientAsync();
  } catch (err) {
    console.warn('⚠️ OAuth client init notice:', err.message);
    return null;
  }

  const token = await loadTokenAsync();
  if (token) {
    oAuth2Client.setCredentials(token);

    // Auto-save refreshed tokens to token.json and DB
    oAuth2Client.on('tokens', async (newTokens) => {
      try {
        const merged = { ...inMemoryToken, ...newTokens };
        await saveTokenAsync(merged);
        console.log('🔄 Google OAuth token automatically refreshed & saved to DB');
      } catch (e) {
        console.warn('⚠️ Could not save refreshed Google token:', e.message);
      }
    });

    // Proactively refresh if expiring within 5 minutes
    const isExpiring = token.expiry_date && (Date.now() >= token.expiry_date - (5 * 60 * 1000));
    if (isExpiring && token.refresh_token) {
      try {
        const { credentials } = await oAuth2Client.refreshAccessToken();
        const merged = { ...token, ...credentials };
        await saveTokenAsync(merged);
        oAuth2Client.setCredentials(merged);
      } catch (refreshErr) {
        console.warn('⚠️ Token proactive refresh notice:', refreshErr.message);
      }
    }

    return oAuth2Client;
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
  loadCredentialsAsync,
  loadTokenAsync,
  saveTokenAsync,
  setInMemoryCreds,
  setInMemoryToken,
  createOAuthClient,
  createOAuthClientAsync,
  getAuthClient
};
