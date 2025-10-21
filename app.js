
// ======================= Imports =======================
const fs = require('fs');
const path = require('path');
const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const sharp = require('sharp');
const qrcode  = require('qrcode');
const { Server } = require('socket.io');
const http = require('http');
const cron = require('node-cron');
const Boom =  require('@hapi/boom'); 

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");


// ======================= Config ========================
const SCOPES = ['https://www.googleapis.com/auth/contacts.readonly'];
const TOKEN_PATH = path.join(__dirname, 'files', 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'files', 'credentials.json');
const MESSAGE_FILE = path.join(__dirname, 'custom_message.txt');
const WA_AUTH_DIR = path.join(__dirname, 'whatsapp_auth');
const PORT = process.env.PORT || 8000;
const frame_style_sheet = path.join(__dirname, 'files', 'frame_style_sheet.json');
const LOG_FILE = path.join(__dirname, 'birthday_log.json');

let birthdaysSentToday = false;
let birthdayRetryMap = new Map();
let styles = null;
let styleId = '1';
let pairingStatus = "idle";
let linkedNumber = null;
// Global socket reference so routes can use it
let sockInstance = null;
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
};
// ======================= Load frame styles =======================
if (!fs.existsSync(frame_style_sheet)) {
  console.error("❌ Missing frame_style_sheet.json (expected at: " + frame_style_sheet + ")");
} else {
  try {
    styles = JSON.parse(fs.readFileSync(frame_style_sheet, 'utf-8'));
    if (!styles.frameStyles) {
      console.error("❌ frame_style_sheet.json missing 'frameStyles' property");
    } else {
      styleId = styles.user_selected_style || styles.defaultStyle || Object.keys(styles.frameStyles)[0] || '1';
      console.log("✅ Frame styles loaded successfully. Selected style:", styleId);
    }
  } catch (err) {
    console.error("❌ Error parsing frame_style_sheet.json:", err.message);
  }
}

// ======================= Express Setup =======================
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
app.use(express.json());

// Helper to safely read JSON file
function safeReadJson(filePath, defaultValue = null) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`⚠️ safeReadJson error (${filePath}):`, err.message);
    return defaultValue;
  }
}

function safeWriteJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`⚠️ safeWriteJson error (${filePath}):`, err.message);
    return false;
  }
}

// ======================= Frame style endpoints =======================
app.get('/api/user-style', (req, res) => {
  try {
    if (!fs.existsSync(frame_style_sheet)) return res.json({ frameStyles: {}, user_selected_style: styleId });
    const raw = fs.readFileSync(frame_style_sheet, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    console.error("❌ Error reading style file:", err);
    res.status(500).json({ error: "Failed to load styles" });
  }
});

app.post('/api/user-style', (req, res) => {
  try {
    const { user_selected_style } = req.body;
    if (!user_selected_style) return res.status(400).json({ error: 'Missing style id' });
    const data = safeReadJson(frame_style_sheet, {});
    data.user_selected_style = user_selected_style;
    if (!safeWriteJson(frame_style_sheet, data)) return res.status(500).json({ error: 'Failed to save style' });
    styleId = user_selected_style;
    res.json({ success: true, user_selected_style });
  } catch (err) {
    console.error("❌ Error saving style:", err);
    res.status(500).json({ error: "Failed to save style" });
  }
});

// ======================= Google OAuth helpers =======================
function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) throw new Error('Missing credentials.json');
  return JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
}

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

function createOAuthClient() {
  const creds = loadCredentials();
  const { client_id, client_secret, redirect_uris } = creds.installed || creds.web || {};
  if (!client_id) throw new Error('Invalid credentials.json format');
  return new google.auth.OAuth2(client_id, client_secret, (redirect_uris && redirect_uris[0]) || 'http://localhost');
}

async function getAuthClient(req, res) {
  const oAuth2Client = createOAuthClient();
  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  } else if (res) {
    const authUrl = oAuth2Client.generateAuthUrl({ access_type: 'offline', scope: SCOPES });
    res.redirect(authUrl);
  }
  return null;
}

// ======================= People API helpers =======================
async function listContacts(auth) {
  const service = google.people({ version: 'v1', auth });
  const res = await service.people.connections.list({ resourceName: 'people/me', pageSize: 2000, personFields: 'names,emailAddresses,phoneNumbers,birthdays,photos' });
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
  const res = await service.people.connections.list({ resourceName: 'people/me', pageSize: 2000, personFields: 'names,phoneNumbers,birthdays,photos' });
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
  try {
    if (fs.existsSync(MESSAGE_FILE)) return fs.readFileSync(MESSAGE_FILE, 'utf8').trim();
  } catch (err) {
    console.error('⚠️ getCustomMessage error:', err.message);
  }
  return '🎉 Happy Birthday! 🎂 Wishing you a fantastic year ahead!';
}

function isGoogleDefaultLetterImage(url) {
  return typeof url === 'string' && url.includes('googleusercontent.com') && url.includes('photo.jpg');
}

// ======================= Profile picture utilities =======================
const WA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://web.whatsapp.com/',
  Accept: 'image/*'
};

async function getValidProfilePicUrl(sock, jid, googlePhotoUrl) {
  // Prefer WhatsApp profile if available, else use googlePhotoUrl if valid, otherwise default avatar
  try {
    // try whatsapp profile first
    if (sock && typeof sock.profilePictureUrl === 'function') {
      try {
        const waUrl = await sock.profilePictureUrl(jid, 'image').catch(() => null);
        if (waUrl) return waUrl.replace(/=s\d+/, '=s10000');
      } catch (e) {
        // ignore
      }
    }

    if (googlePhotoUrl && !isGoogleDefaultLetterImage(googlePhotoUrl)) {
      return googlePhotoUrl.replace(/=s\d+/, '=s10000');
    }
  } catch (err) {
    console.error('⚠️ getValidProfilePicUrl error:', err.message);
  }

  // fallback to default avatar file
  return path.join(__dirname, 'assets', 'img', 'default_avatar.png');
}

async function fetchProfilePicBuffer(profilePicUrl, contactName, maxRetries = 3, retryDelay = 2000) {
  const defaultAvatar = path.join(__dirname, 'assets', 'img', 'default_avatar.png');
  if (!profilePicUrl || typeof profilePicUrl !== 'string' || !profilePicUrl.startsWith('http')) {
    console.log(`⚠ No valid profile picture for ${contactName}, using default avatar`);
    return fs.readFileSync(defaultAvatar);
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const res = await axios.get(profilePicUrl, { responseType: 'arraybuffer', headers: WA_HEADERS, timeout: 8000 });
      if (res.status !== 200 || !res.headers['content-type']?.startsWith('image/')) throw new Error(`Invalid response: ${res.status}`);
      const buffer = await sharp(res.data).resize(300, 300, { fit: 'cover' }).ensureAlpha().png().toBuffer();
      console.log(`✅ Profile picture fetched for ${contactName} (attempt ${attempt + 1})`);
      return buffer;
    } catch (err) {
      attempt++;
      console.error(`❌ Attempt ${attempt} failed for ${contactName}:`, err.message);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, retryDelay));
    }
  }

  console.log(`⚠ All ${maxRetries} attempts failed for ${contactName}, using default avatar`);
  return fs.readFileSync(defaultAvatar);
}

async function createFramedImage(profileBuffer, contactName, styleKey = null) {
  const styleSelected = styleKey || styleId || (styles && styles.user_selected_style) || (styles && styles.defaultStyle) || '1';
  const style = styles && styles.frameStyles ? styles.frameStyles[styleSelected] : null;
  if (!style) return profileBuffer; // nothing to do

  const framePath = path.join(__dirname, style.framePath || '');
  if (!fs.existsSync(framePath)) return profileBuffer;

  try {
    const profileResized = await sharp(profileBuffer).resize(style.profile.width, style.profile.height, { fit: 'cover' }).toBuffer();
    const frameMeta = await sharp(framePath).metadata();
    const contactUpper = (contactName || '').toUpperCase();

    const svgText = `\n      <svg width="${frameMeta.width}" height="${frameMeta.height}">\n        <style>\n          .title { fill: ${style.text.color}; 
    
     font-family: ${style.text.fontFamily};
     font-size: ${style.text.fontSize}; font-weight: bold; text-anchor: middle; dominant-baseline: middle; }\n        </style>\n        <text x="${style.text.x}" y="${style.text.y}" class="title">${contactUpper}</text>\n      </svg>\n    `;

    const finalImage = await sharp({ create: { width: frameMeta.width, height: frameMeta.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
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

// ======================= Birthday Logging & Retry =======================
function logBirthdayEvent(jid, name, status, attempt) {
  let logs = [];
  try {
    if (fs.existsSync(LOG_FILE)) logs = JSON.parse(fs.readFileSync(LOG_FILE));
  } catch (err) {
    console.error("⚠️ Could not read log file:", err.message);
  }

  logs.push({ jid, name, status, attempt, timestamp: new Date().toISOString() });
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (err) {
    console.error("⚠️ Could not write log file:", err.message);
  }
}

// cleanup old retry entries (used by route)
app.get('/clear_list', (req, res) => {
  const now = Date.now();
  let removed = 0;
  for (const [jid, data] of birthdayRetryMap.entries()) {
    if (now - data.timestamp > 24 * 60 * 60 * 1000) {
      birthdayRetryMap.delete(jid);
      removed++;
    }
  }
  res.json({ removed });
});

// ======================= Contacts endpoint (uses Google OAuth) =======================
app.get('/contacts', async (req, res) => {
  try {
    const auth = await getAuthClient(req, res);
    if (!auth) return; // getAuthClient handled redirect
    res.json(await listContacts(auth));
  } catch (err) {
    console.error('Error retrieving contacts:', err.message);
    res.status(500).send('Error retrieving contacts');
  }
});

// ======================= Get tomorrow's contacts from external endpoint =======================
app.get('/api/tomorrow-contacts', async (req, res) => {
  try {
    const response = await axios.get('http://localhost:8000/contacts');
    const contacts = response.data || [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowMonth = tomorrow.getMonth() + 1;
    const tomorrowDay = tomorrow.getDate();

    const tomorrowBirthdays = contacts.filter(contact => contact.birthday && contact.birthday.month === tomorrowMonth && contact.birthday.day === tomorrowDay);
    if (!tomorrowBirthdays.length) return res.json({ message: 'No contacts have a birthday tomorrow.' });

    const birthdayListString = tomorrowBirthdays.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
    res.json({ list: birthdayListString });
  } catch (err) {
    console.error('Error fetching contacts:', err.message);
    res.status(500).json({ error: 'Error fetching contacts.' });
  }
});

// ======================= Sending birthdays =======================
async function sendTodaysBirthdays(sock, senderId) {
  try {
    const auth = await getAuthClient();
    if (!auth) return;

    const birthdays = await getTodayBirthdays(auth);
    if (!birthdays.length) {
      if (senderId) await sock.sendMessage(senderId, { text: '🎉 No birthdays today.' });
      console.log('🎉 No birthdays today.');
      return;
    }

    // Optionally get tomorrow's list to notify the owner
    let allTomorrow = null;
    try {
      const resp = await axios.get('http://localhost:8000/contacts');
      allTomorrow = resp.data;
    } catch (err) {
      allTomorrow = null;
    }

    for (const contact of birthdays) {
      let attempts = 0;
      const maxRetries = 5;
      const delay = 2000;

      while (attempts < maxRetries) {
        try {
          const message = getCustomMessage().replace(/\$\{name\}/g, contact.name);
          const number = contact.phone.replace(/\D/g, '');
          const jid = number + '@s.whatsapp.net';

          const profilePicUrl = await getValidProfilePicUrl(sock, jid, contact.photo);
          const profileBuffer = await fetchProfilePicBuffer(profilePicUrl, contact.name);
          const framedImage = await createFramedImage(profileBuffer, contact.name, styleId);

          // Send message
          await sock.sendMessage(jid, { image: framedImage, caption: message });

          // record retry info so we can retry later if needed
          birthdayRetryMap.set(jid, { message: { image: framedImage, caption: message }, attempts: 1, timestamp: Date.now(), name: contact.name });

          logBirthdayEvent(jid, contact.name, 'sent', 1);
          if (senderId) await sock.sendMessage(senderId, { text: `✅ Birthday message successfully sent to ${contact.name} (${contact.phone})` });
          console.log(`✅ Sent birthday wishes to ${contact.name} (${contact.phone})`);
          break; // success, move to next contact
        } catch (err) {
          attempts++;
          console.error(`❌ Failed to send message to ${contact.name}. Attempt ${attempts} of ${maxRetries}:`, err.message || err);
          if (attempts < maxRetries) await new Promise(res => setTimeout(res, delay));
          else logBirthdayEvent(contact.phone || 'unknown', contact.name, 'failed', attempts);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error sending birthdays:', err.message || err);
  }
}

// ======================= QrCode generator =======================
let latestQR = null;
app.get("/qr-img", async (req, res) => {
  if (!latestQR) return res.status(404).send("No QR yet");
  try {
    const dataUrl = await qrcode.toDataURL(latestQR, { errorCorrectionLevel: "H" });
    const img = Buffer.from(dataUrl.split(",")[1], "base64");
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": img.length });
    res.end(img);
  } catch (err) {
    res.status(500).send(err.message);
  }
});
app.get("/status", (req, res) => {
  res.json({ status: pairingStatus, linked: linkedNumber });
});

app.get("/send-test", async (req, res) => {
  if (pairingStatus !== "paired" || !linkedNumber) {
    return res.json({ ok: false, message: "Not paired yet" });
  }
  try {
    await sockInstance.sendMessage(linkedNumber, {
      text: "✅ successfully Connected Wish Master bot ",
    });
    res.json({ ok: true, message: "Test message sent successfully!" });
  } catch (err) {
    res.json({ ok: false, message: "Failed to send test: " + err.message });
  }
});

async function addReaction(sock, messageKey, reactionEmoji) {
  try {
    if (messageKey) {
      await sock.sendMessage(messageKey.remoteJid, {
        react: { text: reactionEmoji, key: messageKey },
      });
      console.log("Reaction added successfully!");
    }
  } catch (error) {
    console.error("Error adding reaction:", error);
  }
}
// ======================= WhatsApp Bot =======================
async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("./whatsapp_auth");
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      markOnlineOnConnect: false,
      printQRInTerminal: false,
      syncFullHistory: false,
      browser: ["WishMaster", "Chrome", "1.0"]
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, qr, lastDisconnect } = update;

  if (qr) {
        latestQR = qr;
        pairingStatus = "qr-received";
        console.log("📱 Scan the QR to link WhatsApp");
      }

      if (connection === "open") {
        console.log("✅ WhatsApp connected!");
        birthdaysSentToday = false;
        sockInstance = sock;
          wa.sock = sock;
                    wa.isLinked = true;
                    wa.number = sock.user.id.split('@')[0].split(':')[0];
                    wa.me = sock.user.name || null;
                    wa.latestQRDataURL = null;
                    wa.starting = false;
                    wa.startTime = Date.now();
                    birthdaysSentToday = false; // Reset daily flag on reconnect
        
                       console.log(birthdaysSentToday);
                       

      }

      if (connection === "close") {
        // const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log("⚠️ Disconnected. Reason:", lastDisconnect?.error);
                    wa.isLinked = false;


        // Handle each disconnect reason properly
        // switch (reason) {
        //   case DisconnectReason.badSession:
        //     console.log("❌ Bad Session File. Deleting...");
        //     fs.rmSync("./whatsapp_auth", { recursive: true, force: true });
        //     return startBot();

        //   case DisconnectReason.connectionClosed:
        //   case DisconnectReason.connectionLost:
        //   case DisconnectReason.restartRequired:
        //   case DisconnectReason.timedOut:
        //     console.log("🔄 Reconnecting...");
        //     return startBot();

        //   case DisconnectReason.loggedOut:
        //     console.log("🚫 Logged out. Need to scan QR again.");
        //     fs.rmSync("./whatsapp_auth", { recursive: true, force: true });
        //     return startBot();

        //   default:
        //     console.log("❗Unknown reason, reconnecting...");
        //     return startBot();
        // }
      }
    });
    // ✅ Messages listener with better safety + more commands
    sock.ev.on("messages.upsert", async (msgData) => {
      try {
        const message = msgData.messages?.[0];
        const sender = message?.key?.remoteJid;
    
        if (!message?.message || sender.includes("g.us") || sender.includes("status@broadcast")) return;
    
    
    
        // Extract text safely
        const text =
          message.message.conversation ||
          message.message.extendedTextMessage?.text ||
          message.message.imageMessage?.caption ||
          message.message.videoMessage?.caption ||
          message.message.buttonsResponseMessage?.selectedButtonId ||
          message.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
          "";
    
        if (!text) return; // skip empty messages
    
        const command = text.trim().toLowerCase();
        console.log(`👉 From: ${sender} | Text: ${command}`);
    
        // Uptime for alive/ping
        const uptimeMs = Date.now() - (wa.startTime || Date.now());
        const hours = Math.floor(uptimeMs / 3600000);
        const minutes = Math.floor((uptimeMs % 3600000) / 60000);
        const seconds = Math.floor((uptimeMs % 60000) / 1000);
        
        // ================= Manual Birthday Check =================
    
    
    
        // ================= Commands =================
        switch (command) {
          case ".alive":
            await sock.sendMessage(sender, {
              text:
                `✅ Bot is Active!\n\n` +
                `⏱ Uptime: ${hours}h ${minutes}m ${seconds}s\n\n` +
                `> WishMaster v1.0`,
            });
            addReaction(sock, message.key, "👽");
            break;
    
         case ".send":
            await sock.sendMessage(sender, { text: `⏳ Checking for today's birthdays...   
              
              > Wish Master V1.0 | Command` });
               await sock.sendMessage(sender, { text: `✅ Birthday check completed.
                
                > Wish Master V1.0 | Command` });
         await sendTodaysBirthdays(sock ,sender);
            addReaction(sock, message.key, "✅");
            break;
    
          case ".help":
          case ".menu":
            await sock.sendMessage(sender, {
              text:
                `📖 *WishMaster Bot Commands:*\n\n` +
                `.alive - Check bot status\n` +
               
                `.Dev - Get Developer contact\n\n` +
    
    `*This bot is only for one task: to send birthday wishes to a person.*\n\n`+
          `> WishMaster v1.0`
            });
                    addReaction(sock, message.key, "📃");
    
            break;
     
    
    case ".dev":
        await sock.sendMessage(sender, {
            text: ` 👨‍💻 *Developer:*  
    
    ====================================     
    │   
    │ 👨‍💻 *Name:*  
    │    💻 *Imesh Sandeepa (Dark Venom)*  
    │
    │ 📱 *WhatsApp:*  
    │    📲 *+94768902513*  
    │
    │ 📧 *Email:*  
    │    ✉️ *imeshsan2008@gmail.com*  
    │
    │ 🌐 *Website:*  
    │    🔗 *https://imeshsan2008.github.io/*  
    |
    > WishMaster v1.0
    ====================================
    `, 
            
        });
        addReaction(sock, message.key, "👨‍💻");
        break;
    
     case command.includes("thanks"):
      case command.includes("thank you"):
      case command.includes("thank you so much"):
        addReaction(sock, message.key, "❤️");
        break;
    
        }
   } catch (err) {
        console.error("❌ messages.upsert error:", err);
      }
    });

  } catch (err) {
    console.error("❌ startBot error:", err);
  }
}

// Provide endpoints that interact with the running socket
app.get('/api/status', (req, res) => {
  const googleLinked = fs.existsSync(TOKEN_PATH);
  res.json({ google: { linked: googleLinked }, whatsapp: { linked: !!sockInstance, number: sockInstance?.user?.id || null, me: sockInstance?.user?.name || null } });
});

app.get('/api/qr', (req, res) => {
  // emit last-known QR via socket.io if any client requests
  res.json({ message: 'QR served via socket.io events' });
});

app.post('/api/logout/google', async (req, res) => {
  try {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to delete Google token' });
  }
});

// clear WhatsApp session helper
function clearWhatsAppSession() {
  try {
    if (fs.existsSync(WA_AUTH_DIR)) {
      fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('⚠️ clearWhatsAppSession error:', err.message);
  }
}

app.post('/api/logout/whatsapp', async (req, res) => {
  try {
    clearWhatsAppSession();
    // attempt to restart bot will occur by start failure or manual restart
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Failed to logout WhatsApp' });
  }
});

app.get('/sendbirthday', async (req, res) => {
  if (!sockInstance) return res.status(503).json({ ok: false, error: 'WhatsApp not connected' });
  if (birthdaysSentToday) return res.status(429).json({ ok: false, error: 'Birthdays already sent today' });

  try {
    await sockInstance.sendMessage(sockInstance.user.id, { text: `⏳ Checking for today's birthdays... > webEndpoint` });
    await sendTodaysBirthdays(sockInstance, sockInstance.user.id);
    birthdaysSentToday = true;
    res.json({ ok: true, message: 'Birthday check initiated' });
  } catch (err) {
    console.error('sendbirthday endpoint error:', err.message || err);
    res.status(500).json({ ok: false, error: 'Failed to initiate birthday check' });
  }
});

app.get('/birthdaysSentToday', (req, res) => res.json({ birthdaysSentToday }));

app.get('/api/birthday-logs', (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) return res.json([]);
    const logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read log file' });
  }
});

// ======================= Cron jobs =======================
// Reset flag just before midnight Colombo
cron.schedule('0 23 * * *', () => {
  birthdaysSentToday = false;
}, { scheduled: true, timezone: 'Asia/Colombo' });

// ======================= Static & assets =======================
app.use('/assets/img', express.static(path.join(__dirname, 'assets', 'img')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));
app.get('/home', (req, res) => res.sendFile(path.join(__dirname, 'templates', 'index.html')));

// ======================= Socket.IO =======================
// io.on('connection', (socket) => {
//   console.log('Client connected');
//   socket.on('disconnect', () => console.log('Client disconnected'));
// });

// ======================= Start Server =======================
    // startBot();

server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await startBot();
    console.log('WhatsApp bot started');
  } catch (err) {
    console.error('Failed to start WhatsApp bot on server start:', err.message || err);
  }
});

// Graceful shutdown
process.on('SIGINT', () => { console.log('Shutting down...'); process.exit(0); });
process.on('SIGTERM', () => { console.log('Shutting down...'); process.exit(0); });
