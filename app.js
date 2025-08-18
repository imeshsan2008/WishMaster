// ======================= Imports =======================
const fs = require('fs');
const path = require('path');
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const sharp = require('sharp');
const os = require('os');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const http = require('http');
const cron = require('node-cron');


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
const frame_style_sheet = 'files/frame_style_sheet.json';
// Load frame styles
let styles; // Declare styles outside the block
let wa = {
  sock: null,
  latestQRDataURL: null,
  isLinked: false,
  number: null,
  me: null,
  profilePicUrl: null,
  starting: false,
  qrCount: 0,
  maxQr: 5
};if (!fs.existsSync(frame_style_sheet)) {
  console.error("❌ Missing frame_style_sheet.json");
} else {
  try {
    styles = JSON.parse(fs.readFileSync(frame_style_sheet, 'utf-8'));
    if (!styles.frameStyles || !styles.user_selected_style) {
      console.error("❌ Invalid frame_style_sheet.json format");
    } else {
      console.log("✅ Frame styles loaded successfully");
    }
  } catch (err) {
    console.error("❌ Error parsing frame_style_sheet.json:", err.message);
  }
}

let styleId = styles?.user_selected_style || styles?.defaultStyle || '1'; // Default to '1' if not set

// ======================= Express Setup =======================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
app.use(express.json());


// ======================= Helper Functions =======================
// Endpoint to update user_selected_style
app.post('/update-style', (req, res) => {
  const { style } = req.body; // expect { "style": "2" }

  if (!style) {
    return res.status(400).json({ error: 'Style parameter is required' });
  }

  try {
    const data = fs.readFileSync(frameStyleSheetPath, 'utf-8');
    const json = JSON.parse(data);

    json.user_selected_style = style;

    fs.writeFileSync(frameStyleSheetPath, JSON.stringify(json, null, 2), 'utf-8');

    return res.json({ message: `user_selected_style updated to ${style}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update style' });
  }
});

async function createFramedImage(profileBuffer, contactName, styleId = null) {
  // Pick style key
  const styleKey = styleId || styles.user_selected_style || styles.defaultStyle || '1';
  const style = styles.frameStyles[styleKey];

  if (!style) {
    console.error(`❌ Style ID ${styleKey} not found in frame_style_sheet.json`);
    return profileBuffer;
  }

  const framePath = path.join(__dirname, style.framePath);
  if (!fs.existsSync(framePath)) {
    console.error(`❌ Frame image missing: ${framePath}`);
    return profileBuffer;
  }

  try {
    // Resize profile according to selected style
    const profileResized = await sharp(profileBuffer)
      .resize(style.profile.width, style.profile.height, { fit: 'cover' })
      .toBuffer();

    // Get frame metadata
    const frameMeta = await sharp(framePath).metadata();
    contactName = contactName.toUpperCase();

    // SVG for text
    const svgText = `
      <svg width="${frameMeta.width}" height="${frameMeta.height}">
        <style>
          .title {
            fill: ${style.text.color};
            font-family: ${style.text.fontFamily};
            text-align: center;
            dominant-baseline: middle;
            font-size: ${style.text.fontSize};
            font-weight: bold;
            text-anchor: middle;
          }
        </style>
        <text x="${style.text.x}" y="${style.text.y}" class="title">${contactName}</text>
      </svg>
    `;

    // Composite layers
    const finalImage = await sharp({
      create: {
        width: frameMeta.width,
        height: frameMeta.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([
        { input: profileResized, top: style.profile.top, left: style.profile.left },
        { input: framePath, top: 0, left: 0 },
        { input: Buffer.from(svgText), top: 0, left: 0 }
      ])
      .png()
      .toBuffer();

    return finalImage;
  } catch (err) {
    console.error(`❌ Error creating framed image for ${contactName}:`, err.message);
    return profileBuffer;
  }

}

// ========== GET all styles + current ==========
app.get("/api/user-style", (req, res) => {
  try {
    if (!fs.existsSync(frame_style_sheet)) {
      return res.json({ frameStyles: {}, user_selected_style: "1" });
    }

    const raw = fs.readFileSync(frame_style_sheet, "utf8");
    const data = JSON.parse(raw);

    res.json(data); // returns { frameStyles: {...}, user_selected_style: "1" }
  } catch (err) {
    console.error("❌ Error reading style file:", err);
    res.status(500).json({ error: "Failed to load styles" });
  }
});

// ========== POST update selected style ==========
app.post("/api/user-style", (req, res) => {
  try {
    const { user_selected_style } = req.body;
    if (!user_selected_style) {
      return res.status(400).json({ error: "Missing style id" });
    }

    const raw = fs.readFileSync(frame_style_sheet, "utf8");
    const data = JSON.parse(raw);

    // update current selection
    data.user_selected_style = user_selected_style;

    fs.writeFileSync(frame_style_sheet, JSON.stringify(data, null, 2), "utf8");

    res.json({ success: true, user_selected_style });
  } catch (err) {
    console.error("❌ Error saving style:", err);
    res.status(500).json({ error: "Failed to save style" });
  }
});

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
async function sendTodaysBirthdays(sock) {
  try {
    const auth = await getAuthClient();
    if (!auth) return;

    const birthdays = await getTodayBirthdays(auth);
    if (!birthdays.length) {
      console.log('🎉 No birthdays today.');
      return;
    }

    for (const contact of birthdays) {
      // Get a fresh custom message
      let message = getCustomMessage();

      // Replace placeholder with contact name
      message = message.replace('${name}', contact.name);

      // Format WhatsApp JID
      let number = contact.phone.replace(/\D/g, '');
      const jid = number + '@s.whatsapp.net';

      // Get profile picture
      const profilePicUrl = await getValidProfilePicUrl(sock, jid, contact.photo);
      const profileBuffer = await fetchProfilePicBuffer(profilePicUrl, contact.name);

      // Create framed image
      const framedImage = await createFramedImage(profileBuffer, contact.name, styleId);

      // Send message
      await sock.sendMessage(jid, { image: framedImage, caption: message });

      console.log(`✅ Sent birthday wishes to ${contact.name} (${contact.phone})`);
    }
  } catch (err) {
    console.error('❌ Error sending birthdays:', err.message);
  }
}

// ======================= WhatsApp Bot =======================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);

    const sock = makeWASocket({ 
    auth: state,
    shouldSyncHistoryMessage: false,
    markOnlineOnConnect: false,
    printQRInTerminal: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    });

    sock.ev.on('creds.update', saveCreds);


    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

if (qr) {
  wa.latestQRDataURL = await QRCode.toDataURL(qr);
  wa.qrCount = 0;
  
  wa.qrCount ++; // Increment QR count
  console.log("📷 New QR code generated");
  console.log("QR Data URL length:", wa.latestQRDataURL.length); // useful for checking if QR was generated
  console.log("QR Count reset to:", wa.qrCount);

  io.emit('qr', { dataUrl: wa.latestQRDataURL, count: wa.qrCount });
  console.log("📡 QR code emitted via Socket.IO");
}


        if (connection === 'open') {
  
    io.emit('connected');   
    console.log("✅ WhatsApp connected!");
            wa.sock = sock;
            wa.isLinked = true;
            wa.number = sock.user.id.split('@')[0].split(':')[0];
            wa.me = sock.user.name || null;
            wa.latestQRDataURL = null; // Reset QR data URL on successful connection

            try {
                wa.profilePicUrl = await sock.profilePictureUrl("me", 'image');
                console.log(`✅ Profile picture URL: ${wa.profilePicUrl}`);
            } catch {
                wa.profilePicUrl = null;
                console.log("⚠️ No profile picture found");
            }

            wa.starting = false;

cron.schedule('0 0 * * *', async () => {  // Make the callback async
    try {
        console.log('Running birthday check at midnight (Sri Lanka time)');
        
        // Send birthday wishes (if function exists)
        if (typeof sendTodaysBirthdays === "function") {
            await sendTodaysBirthdays(sock);  // Now await works properly
        }
    } catch (error) {
        console.error('Error in birthday cron job:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Colombo"  // Sri Lanka's timezone
});

        }  if (connection === 'close') {
    wa.isLinked = false;
    io.emit('disconnected');  // 🔥 notify frontend
    console.log("⚠️ WhatsApp disconnected!");
  }
    });

}


// ======================= API Routes =======================

app.get('/api/status', (req, res) => {
  const googleLinked = fs.existsSync(TOKEN_PATH);
  res.json({
    google: { linked: googleLinked },
    whatsapp: {

      linked: wa.isLinked,
      number: wa.number,
      me: wa.me,
      profilePicUrl: wa.profilePicUrl || null
    }
    
  });
          // console.log(wa);

});


app.get('/api/qr', (req, res) => {
  if (wa.latestQRDataURL) {
    if (wa.qrCount < wa.maxQr) {
      wa.qrCount++;
      console.log(`QR Generated #${wa.qrCount}`);
      res.json({ dataUrl: wa.latestQRDataURL, count: wa.qrCount });
    } else {
      io.emit('qr_limit', { message: 'QR attempts exceeded, please refresh page' });
      res.status(429).json({ error: 'QR attempts exceeded' });
    }
  } else {
    res.status(404).json({ error: 'No QR available' });
  }
});


app.post('/api/logout/google', async (req, res) => {
  try {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to delete Google token' });
  }
});

app.post('/api/logout/whatsapp', async (req, res) => {
  try {
    await clearWhatsAppSession();
    // restart so a new QR becomes available immediately
    await startWhatsApp();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to logout WhatsApp' });
  }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));

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
    // res.send('Authorization successful! ');
    res.redirect('/home?success=true'); // Redirect to contacts page
    // res.send('Authorization successful!');
  } catch (err) {
    res.status(500).send('Error retrieving access token');
  }
});
// serve assets
app.get('/assets/img/:file', (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'img', req.params.file));
});


const deleteFolderRecursive = (folderPath) => {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach(file => {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
  }
};
 
const deleteFilesRecursive = (filePath) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};


app.get('/api/reset', (req, res) => {
  if (WA_AUTH_DIR && fs.existsSync(WA_AUTH_DIR)) {
    const filesBefore = fs.readdirSync(WA_AUTH_DIR);

    if (filesBefore.length > 0 || fs.existsSync(TOKEN_PATH)) {
      deleteFolderRecursive(WA_AUTH_DIR); // delete all files and subfolders
      deleteFilesRecursive(TOKEN_PATH); // delete token file
      res.json({ deleted: true, filesDeleted: filesBefore });

      console.log('All WhatsApp auth files deleted. Restarting server...');
      process.exit(0); // Only restart if files were deleted
      return;
    }
  }

  // If no files to delete
  res.json({ deleted: false });
});

// Socket.IO
io.on('connection', (socket) => {
    io.emit('qr', { dataUrl: wa.latestQRDataURL, count: wa.qrCount });

  console.log('Client connected');
  socket.on('disconnect', () => console.log('Client disconnected'));
});

// ======================= Start Server =======================
server.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);

  startBot();



});

