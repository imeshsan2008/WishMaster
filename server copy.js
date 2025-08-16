// ======================= Imports =======================
const fs = require('fs');
const path = require('path');
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const sharp = require('sharp');
const os = require('os');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState
} = require('@whiskeysockets/baileys');

// ======================= Config ========================
const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];
const TOKEN_PATH = 'files/token.json';
const CREDENTIALS_PATH = 'files/credentials.json';
const MESSAGE_FILE = 'custom_message.txt';
const WA_AUTH_DIR = 'whatsapp_auth';
const PORT = 3000;

const app = express();
app.use(express.json());

// ======================= Helper Functions =======================
function isGoogleDefaultLetterImage(url) {
  return typeof url === 'string' && url.includes('googleusercontent.com') && url.includes('photo.jpg');
}

function loadCredentials() {
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
}

function createOAuthClient() {
  const { client_id, client_secret, redirect_uris } = loadCredentials().installed;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function getAuthClient(req, res) {
  const oAuth2Client = createOAuthClient();
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } else if (res) {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });
    res.redirect(authUrl);
  }
  return null;
}

async function listContacts(auth) {
  const service = google.people({ version: 'v1', auth });
  const res = await service.people.connections.list({
    resourceName: 'people/me',
    pageSize: 1000,
    personFields: 'names,emailAddresses,phoneNumbers,birthdays,photos',
  });

  return (res.data.connections || [])
    .filter(p => p.birthdays && p.birthdays.length > 0)
    .map(p => ({
      name: p.names ? p.names[0].displayName : '',
      emails: p.emailAddresses ? p.emailAddresses.map(e => e.value) : [],
      phones: p.phoneNumbers ? p.phoneNumbers.map(ph => ph.value) : [],
      birthday: p.birthdays ? p.birthdays[0].date : null,
      photo: p.photos ? p.photos[0].url : null
    }));
}

async function getTodayBirthdays(auth) {
  const service = google.people({ version: 'v1', auth });
  const res = await service.people.connections.list({
    resourceName: 'people/me',
    pageSize: 2000,
    personFields: 'names,phoneNumbers,birthdays,photos',
  });

  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();

  return (res.data.connections || [])
    .filter(p => p.birthdays && p.birthdays.some(b => b.date && b.date.month === month && b.date.day === day))
    .map(p => ({
      name: p.names ? p.names[0].displayName : 'Unknown',
      phone: p.phoneNumbers ? p.phoneNumbers[0].value : null,
      photo: p.photos ? p.photos[0].url : null
    }))
    .filter(p => p.phone);
}

function getCustomMessage() {
  if (fs.existsSync(MESSAGE_FILE)) {
    return fs.readFileSync(MESSAGE_FILE, 'utf8').trim();
    
  }
  return '🎉 Happy Birthday! 🎂 Wishing you a fantastic year ahead!';
}

async function getValidProfilePicUrl(sock, jid, googlePhotoUrl) {
  let profilePicUrl = null;

  try {
    profilePicUrl = await sock.profilePictureUrl(jid, 'image');
    console.log(`✅ Got WhatsApp photo: ${profilePicUrl}`);
  } catch {
    console.log(`⚠ No WhatsApp photo for ${jid}`);
  }

  if (!profilePicUrl && googlePhotoUrl && !isGoogleDefaultLetterImage(googlePhotoUrl)) {
    profilePicUrl = googlePhotoUrl;
    console.log(`✅ Using Google contact photo`);
  }

  if (profilePicUrl.includes('googleusercontent.com')) {
  profilePicUrl = profilePicUrl.replace(/=s\d+/, '=s10000'); // Ensure high resolution   
  }

  if (!profilePicUrl) {
    profilePicUrl = path.join(__dirname, 'assets', 'img', 'default_avatar.png');
    console.log(`ℹ Using default avatar`);
  }

  return profilePicUrl;

}
// Mimic WhatsApp Web headers for profile picture downloads
const WA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://web.whatsapp.com/',
  'Accept': 'image/*',
  'Sec-Fetch-Mode': 'no-cors'
};
// ======================= Create Framed Image =======================// ======================= Download or Fetch Profile Picture =======================
async function fetchProfilePicBuffer(profilePicUrl, contactName) {
  const defaultAvatar = path.join(__dirname, 'assets', 'img', 'default_avatar.png');

  // If no valid URL, return default
  if (!profilePicUrl || !profilePicUrl.startsWith('http')) {
    console.log(`⚠ No valid profile picture for ${contactName}, using default avatar`);
    return fs.readFileSync(defaultAvatar);
  }

  try {
    const res = await axios.get(profilePicUrl, { responseType: 'arraybuffer', headers: WA_HEADERS });
    if (res.status !== 200 || !res.headers['content-type']?.startsWith('image/')) {
      console.log(`⚠ Failed to download image for ${contactName}, using default avatar`);
      return fs.readFileSync(defaultAvatar);
    }

    // Convert to PNG buffer if needed
    const buffer = await sharp(res.data)
      .resize(300, 300, { fit: 'cover' })
      .ensureAlpha()
      .png()
      .toBuffer();

    return buffer;

  } catch (err) {
    console.error(`❌ Error fetching profile pic for ${contactName}:`, err.message);
    return fs.readFileSync(defaultAvatar);
  }
}

// ======================= WhatsApp Bot =======================



// ======================= WhatsApp Bot =======================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
  const sock = makeWASocket({ auth: state });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection }) => {
    if (connection === 'open') {
      console.log('✅ WhatsApp connected! Checking birthdays...');
      try {
        const auth = await getAuthClient();
        if (!auth) return;

        const birthdays = await getTodayBirthdays(auth);
        if (!birthdays.length) {
          console.log('No birthdays today.');
          return;
        }


       for (const contact of birthdays) {
    // Get a fresh copy every time
    let message = getCustomMessage();

    // Replace placeholder
    message = message.replace('${name}', contact.name);

    console.log(message);

    let number = contact.phone.replace(/\D/g, '');
    const jid = number + '@s.whatsapp.net';

    const profilePicUrl = await getValidProfilePicUrl(sock, jid, contact.photo);
    const profileBuffer = await fetchProfilePicBuffer(profilePicUrl, contact.name);

    await sock.sendMessage(jid, { image: profileBuffer, caption: message });
    console.log(`✅ Sent profile photo to ${contact.name} (${contact.phone})`);
}

      } catch (err) {
        console.error('❌ Error in birthday process:', err.message);
      }
    }
  });
}

// ======================= API Routes =======================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));
app.get('/contacts', async (req, res) => {
  try {
    const auth = await getAuthClient(req, res);
    if (!auth) return;
    res.json(await listContacts(auth));
  } catch (err) {
    res.status(500).send('Error retrieving contacts');
  }
});
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  const oAuth2Client = createOAuthClient();
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
    res.send('Authorization successful! Go to /contacts');
  } catch (err) {
    res.status(500).send('Error retrieving access token');
  }
});

// ======================= Start Server =======================
app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
  startBot();
});
