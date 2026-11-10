const fs = require('fs');
const path = require('path');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { PATHS, BOT_VERSION } = require('../config/env.config');

let sockInstance = null;
let latestQR = null;
let pairingStatus = 'idle';
let linkedNumber = null;
let startTime = null;
const PROTO_CACHE_FILE = path.join(PATHS.FILES_DIR, 'sent_proto_cache.json');
const sentMessageWishMap = new Map();
const sentMessageProtoCache = new Map();
const deliveredCardRecipients = new Set();
let lastSentWish = null;
let reconnectTimer = null;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// Initialize Proto Cache from disk to persist across server restarts
try {
  if (fs.existsSync(PROTO_CACHE_FILE)) {
    const raw = fs.readFileSync(PROTO_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    for (const [k, v] of Object.entries(parsed)) {
      sentMessageProtoCache.set(k, v);
    }
  }
} catch (e) {
  console.warn('⚠️ Could not load proto cache from disk:', e.message);
}

let protoSaveTimer = null;
function persistProtoCache() {
  if (protoSaveTimer) return;
  protoSaveTimer = setTimeout(() => {
    protoSaveTimer = null;
    try {
      const obj = Object.fromEntries(sentMessageProtoCache);
      fs.writeFileSync(PROTO_CACHE_FILE, JSON.stringify(obj), 'utf8');
    } catch (e) {}
  }, 3000);
}

function trackSentWish(msgId, jid, wish) {
  if (msgId && wish) sentMessageWishMap.set(String(msgId), wish);
  if (wish) lastSentWish = wish;
}

function cacheSentProtoMessage(id, msg) {
  if (id && msg) {
    sentMessageProtoCache.set(String(id), msg);
    if (sentMessageProtoCache.size > 1000) {
      const oldestKey = sentMessageProtoCache.keys().next().value;
      sentMessageProtoCache.delete(oldestKey);
    }
    persistProtoCache();
  }
}

const waState = {
  isLinked: false,
  number: null,
  me: null,
  profilePicUrl: null,
  starting: false
};

async function addReaction(sock, messageKey, reactionEmoji) {
  try {
    if (sock && messageKey) {
      await sock.sendMessage(messageKey.remoteJid, {
        react: { text: reactionEmoji, key: messageKey }
      });
    }
  } catch (error) {
    console.error('⚠️ Error adding reaction:', error.message);
  }
}

async function handleDirectCardDelivery(sock, sender, message) {
  try {
    const senderPhone = (sender || '').replace(/\D/g, '');
    const senderKey = senderPhone ? senderPhone.slice(-9) : String(sender);

    // ANTI-DUPLICATION CHECK: If this recipient already received the card, NEVER send again!
    if (deliveredCardRecipients.has(sender) || (senderKey && deliveredCardRecipients.has(senderKey))) {
      console.log(`🚫 [Anti-Duplication] Recipient ${sender} (${senderKey}) already received card. 2nd "1" reply blocked. No messages sent.`);
      return;
    }

    const { getWishByCode, getLatestWishByPhone, getActiveWishesLast7Days, getSyncedContacts, markWishCardDelivered } = require('./db.service');
    const { fetchProfilePicBuffer, createFramedImage } = require('./image.service');
    let wish = null;

     wish = await getLatestWishByPhone(senderPhone);

    // 1. Check if recipient quoted a message with a wish URL: e.g. /wish/18d59bc9b58f7822da3eb74e6399c8ab
    const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const quotedText = quoted?.conversation || quoted?.extendedTextMessage?.text || '';
    const match = quotedText.match(/\/wish\/([a-f0-9]{16,64})/i);
    if (match && match[1]) {
      wish = await getWishByCode(match[1]);
      if (wish) console.log(`🎯 Matched wish by quoted link code: ${wish.unique_code} (${wish.contact_name})`);
    }

    // 2. Check quoted stanzaId against sentMessageWishMap
    const stanzaId = message.message?.extendedTextMessage?.contextInfo?.stanzaId;
    if (!wish && stanzaId && sentMessageWishMap.has(String(stanzaId))) {
      wish = sentMessageWishMap.get(String(stanzaId));
      console.log(`🎯 Matched wish by quoted stanza ID: ${wish.unique_code} (${wish.contact_name})`);
    }

    // 3. If sender is standard phone number (@s.whatsapp.net), look up in DB by phone
    if (!wish && senderPhone && !sender.includes('@lid')) {
      wish = await getLatestWishByPhone(senderPhone);
    }

    // 4. Try matching active wishes by pushName
    const activeWishes = await getActiveWishesLast7Days();
    const pushName = (message.pushName || '').trim().toLowerCase();

    if (!wish && activeWishes && activeWishes.length > 0 && pushName) {
      const foundByName = activeWishes.find(w => {
        const wName = (w.contact_name || '').toLowerCase();
        return wName === pushName || wName.includes(pushName) || pushName.includes(wName);
      });
      if (foundByName) {
        wish = foundByName;
        console.log(`🎯 Matched active wish by pushName "${message.pushName}": ${wish.unique_code} (${wish.contact_name})`);
      }
    }

    // 5. Fallback: match in-memory last sent wish or most recent active wish
    if (!wish) {
      if (lastSentWish) {
        wish = lastSentWish;
        console.log(`🎯 Fallback matched in-memory last sent wish: ${wish.unique_code} (${wish.contact_name})`);
      } else if (activeWishes && activeWishes.length > 0) {
        wish = activeWishes[0];
        console.log(`🎯 Fallback matched latest active wish: ${wish.unique_code} (${wish.contact_name})`);
      }
    }

    // DB ANTI-DUPLICATION CHECK
    if (wish?.card_delivered_wa || (wish?.unique_code && deliveredCardRecipients.has(wish.unique_code))) {
      deliveredCardRecipients.add(sender);
      if (senderKey) deliveredCardRecipients.add(senderKey);
      console.log(`🚫 [Anti-Duplication] DB indicates card already delivered to ${wish?.contact_name || sender}. 2nd "1" reply blocked. No messages sent.`);
      return;
    }

    // Immediately register in anti-duplication cache BEFORE dispatching to prevent rapid race conditions
    deliveredCardRecipients.add(sender);
    if (senderKey) deliveredCardRecipients.add(senderKey);
    if (wish?.unique_code) deliveredCardRecipients.add(wish.unique_code);
    if (markWishCardDelivered) {
      markWishCardDelivered(wish?.unique_code, senderPhone).catch(() => {});
    }

    let contactName = wish ? wish.contact_name : null;
    let photoUrl = wish ? wish.photo_url : null;

    if (!contactName) {
      const contacts = await getSyncedContacts();
      const found = contacts.find(c => {
        const cName = (c.name || '').toLowerCase();
        const matchesPhone = senderPhone && !sender.includes('@lid') && c.phones?.some(p => p.replace(/\D/g, '').endsWith(senderPhone.slice(-9)));
        const matchesName = pushName && (cName === pushName || cName.includes(pushName) || pushName.includes(cName));
        return matchesPhone || matchesName;
      });
      if (found) {
        contactName = found.name;
        photoUrl = found.photo;
      }
    }

    contactName = contactName || message.pushName || '';

    // If photoUrl is still null, attempt live WhatsApp profile picture
    if (!photoUrl && sock) {
      try {
        photoUrl = await sock.profilePictureUrl(sender, 'image');
        if (photoUrl) console.log(`📸 Fetched live profile picture from WhatsApp for ${sender}`);
      } catch (e) {}
    }

    let imageBuffer = null;

    if (wish && wish.framed_image_url) {
      const imgPath = path.isAbsolute(wish.framed_image_url)
        ? wish.framed_image_url
        : path.join(PATHS.ROOT_DIR, wish.framed_image_url.replace(/^\/+/, ''));
      if (fs.existsSync(imgPath)) {
        imageBuffer = fs.readFileSync(imgPath);
        console.log(`🖼️ Loaded existing framed image: ${imgPath}`);
      }
    }

    if (!imageBuffer) {
      // Find contact by phone in synced contacts
      let photoUrl = wish ? wish.photo_url : null;
      if (!contactName) {
        const contacts = await getSyncedContacts();
        const found = contacts.find(c =>
          c.phones?.some(p => p.replace(/\D/g, '').endsWith(senderPhone.slice(-9)))
        );
        if (found) {
          contactName = found.name;
          photoUrl = found.photo;
        }
      }
      contactName = contactName || 'Friend';
      console.log(`🎨 Generating framed birthday image for: ${contactName}`);
      const buf = await fetchProfilePicBuffer(photoUrl, contactName);
      imageBuffer = await createFramedImage(buf, contactName);
    }

    const caption =
      `🎂✨ *සුභ උපන්දිනයක් වේවා, ${contactName}!* 🎉🎈\n\n` +
      `මෙන්න ඔබ වෙනුවෙන්ම සකස් කළ විශේෂ උපන්දින ඡායාරූප කාඩ්පත! 🎁❤️\n\n` +
      (wish?.message ? `💌 *හදවතින්ම ලියූ සුබපැතුම:* \n"${wish.message}"\n\n` : '') +
      `> WishMaster`;

    if (imageBuffer) {
      const sentImg = await sock.sendMessage(sender, {
        image: imageBuffer,
        caption
      }, { quoted: message });
      if (sentImg?.key?.id && sentImg?.message) cacheSentProtoMessage(sentImg.key.id, sentImg.message);
    } else {
      const sentTxt = await sock.sendMessage(sender, {
        text: caption
      }, { quoted: message });
      if (sentTxt?.key?.id && sentTxt?.message) cacheSentProtoMessage(sentTxt.key.id, sentTxt.message);
    }

    // Deliver voice note ONLY upon reply (with 800ms spacing to prevent ratchet collision)
    try {
      const { sendVoiceNote } = require('./voice.service');
      await new Promise(r => setTimeout(r, 800));
      await sendVoiceNote(sock, sender, 'voice');
      console.log(`🎤 Birthday voice note delivered to ${sender} upon reply`);
    } catch (ve) {
      console.warn('⚠️ Could not send voice note on reply:', ve.message);
    }

    await addReaction(sock, message.key, '🎉');
    console.log(`✅ Direct birthday card delivered in Sinhala to ${sender} for ${contactName}`);
  } catch (err) {
    console.error('❌ Error delivering direct card to WhatsApp:', err.message || err);
  }
}

function formatUptime(uptimeMs) {
  const seconds = Math.floor((uptimeMs / 1000) % 60);
  const minutes = Math.floor((uptimeMs / (1000 * 60)) % 60);
  const hours = Math.floor((uptimeMs / (1000 * 60 * 60)) % 24);
  const days = Math.floor((uptimeMs / (1000 * 60 * 60 * 24)) % 30);
  const months = Math.floor((uptimeMs / (1000 * 60 * 60 * 24 * 30)) % 12);
  const years = Math.floor(uptimeMs / (1000 * 60 * 60 * 24 * 365));

  const parts = [];
  if (years) parts.push(`${years}y`);
  if (months) parts.push(`${months}mo`);
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds) parts.push(`${seconds}s`);

  return parts.join(' ') || '0s';
}

async function startBot() {
  if (waState.starting) return sockInstance;
  waState.starting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(PATHS.WA_AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const retryStore = new Map();
    const msgRetryCounterCache = {
      get: (key) => retryStore.get(key),
      set: (key, val) => retryStore.set(key, val),
      del: (key) => retryStore.delete(key)
    };

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,
      printQRInTerminal: false,
      syncFullHistory: false,
      msgRetryCounterCache,
      getMessage: async (key) => {
        if (key?.id && sentMessageProtoCache.has(key.id)) {
          return sentMessageProtoCache.get(key.id);
        }
        // Fallback message so Baileys can re-encrypt and answer the client's retry receipt
        return { conversation: '🎂 WishMaster Birthday Surprise' };
      },
      browser: ['WishMaster', 'Chrome', '124.0.0']
    });

    sockInstance = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        latestQR = qr;
        pairingStatus = 'qr-received';
        console.log('📱 Scan the QR to link WhatsApp');
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp connected successfully!');
        pairingStatus = 'paired';
        waState.isLinked = true;
        waState.starting = false;
        startTime = Date.now();

        if (sock.user?.id) {
          linkedNumber = sock.user.id.split('@')[0].split(':')[0].replace(/\D/g, '');
          waState.number = linkedNumber;
        }

        waState.me = sock.user?.name || null;
        latestQR = null;

        // Auto catch-up on connect: if server booted/restarted, check if today's birthdays are sent
        setTimeout(() => {
          try {
            const { checkAndCatchUpTodaysBirthdays } = require('./birthday.service');
            checkAndCatchUpTodaysBirthdays(sock);
          } catch (e) {
            console.warn('⚠️ Error triggering catch-up on connect:', e.message);
          }
        }, 12000);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log('⚠️ WhatsApp connection closed. Reconnecting:', shouldReconnect);
        waState.isLinked = false;
        waState.starting = false;
        pairingStatus = 'disconnected';

        clearReconnectTimer();

        if (shouldReconnect) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            startBot();
          }, 3000);
        } else {
          sockInstance = null;
        }
      }
    });

    // Message Listener
    sock.ev.on('messages.upsert', async (msgData) => {
      try {
        if (!msgData?.messages?.length) return;

        // Cache all messages for retry requests (fixes "Waiting for this message")
        for (const m of msgData.messages) {
          if (m?.key?.id && m?.message) {
            cacheSentProtoMessage(m.key.id, m.message);
          }
        }

        if (msgData?.type !== 'notify') return;

        const message = msgData.messages[0];
        const sender = message?.key?.remoteJid;

        // Ignore empty messages, groups, and status updates
        if (!message?.message || !sender || sender.includes('g.us') || sender.includes('status@broadcast')) {
          return;
        }

        const text =
          message.message.conversation ||
          message.message.extendedTextMessage?.text ||
          message.message.imageMessage?.caption ||
          message.message.videoMessage?.caption ||
          message.message.buttonsResponseMessage?.selectedButtonId ||
          message.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
          '';

        if (!text) return;
        const command = text.trim().toLowerCase();
        console.log(`👉 WA Msg From: ${sender} | Text: "${command}"`);

        // Check if this is an Admin approval reply for multi-number contact (from +94768902513)
        const cleanSender = String(sender || '').replace(/\D/g, '');
        if (cleanSender.endsWith('94768902513')) {
          try {
            const { handleAdminApprovalReply, hasPendingAdminApproval } = require('./birthday.service');
            if (hasPendingAdminApproval()) {
              const handled = await handleAdminApprovalReply(sock, sender, command);
              if (handled) return;
            }
          } catch (e) {
            console.error('Error handling admin approval reply:', e);
          }
        }

        // Check if recipient requested birthday card directly on WhatsApp ("1" or "1.")
        if (command === '1' || command === '1.' || command === '1!' || /^1[\.\s]*$/.test(command)) {
          console.log(`🎁 Recipient ${sender} replied "1" -> delivering birthday card directly into chat`);
          await handleDirectCardDelivery(sock, sender, message);
          return;
        }

        const uptimeText = formatUptime(Date.now() - (startTime || Date.now()));

        // Command routing
        switch (command) {
          case '.alive':
            await sock.sendMessage(sender, {
              text: `✅ Bot is Active!\n\n⏱ Uptime: ${uptimeText}\n\n> WishMaster ${BOT_VERSION}`
            });
            await addReaction(sock, message.key, '👽');
            break;

          case '.send': {
            await sock.sendMessage(sender, {
              text: `⏳ Checking for today's birthdays...\n\n> WishMaster ${BOT_VERSION} | Command`
            });

            // Lazy require to avoid circular dependencies
            const { sendTodaysBirthdays } = require('./birthday.service');
            await sendTodaysBirthdays(sock, sender);

            await sock.sendMessage(sender, {
              text: `✅ Birthday check completed.\n\n> WishMaster ${BOT_VERSION} | Command`
            });
            await addReaction(sock, message.key, '✅');
            break;
          }

          case '.help':
          case '.menu':
            await sock.sendMessage(sender, {
              text:
                `📖 *WishMaster Bot Commands:*\n\n` +
                `.alive - Check bot status\n` +
                `.send - Trigger today's birthday wishes\n` +
                `.dev - Developer contact\n\n` +
                `*This bot sends birthday & festive wishes automatically.*\n\n` +
                `> WishMaster ${BOT_VERSION}`
            });
            await addReaction(sock, message.key, '📃');
            break;

          case '.dev':
            await sock.sendMessage(sender, {
              text: `👨‍💻 Developer: Imesh Sandeepa`
            });
            await addReaction(sock, message.key, '👨‍💻');
            break;
        }

        // Auto Reactions
        if (command.includes('thanks') || command.includes('thank you') || command.includes('thankyou')) {
          await addReaction(sock, message.key, '❤️');
        }

        if (command.includes('happy new year') || command.includes('new year') || command.includes('hny') || command.includes('happynewyear')) {
          const reactions = ['🎉', '🥳', '🎆', '🎊', '✨'];
          const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
          await addReaction(sock, message.key, randomReaction);
        }
      } catch (err) {
        console.error('❌ messages.upsert error:', err.message || err);
      }
    });

    return sock;
  } catch (err) {
    waState.starting = false;
    console.error('❌ startBot error:', err.message || err);
    throw err;
  }
}

async function restartWhatsAppBot() {
  clearReconnectTimer();
  waState.starting = false;
  waState.isLinked = false;
  pairingStatus = 'disconnected';

  if (sockInstance) {
    try {
      sockInstance.ev.removeAllListeners();
      sockInstance.end();
    } catch (e) {}
    sockInstance = null;
  }

  await new Promise(r => setTimeout(r, 1000));
  return startBot();
}

function clearWhatsAppSession() {
  clearReconnectTimer();
  waState.starting = false;
  waState.isLinked = false;
  pairingStatus = 'disconnected';

  if (sockInstance) {
    try {
      sockInstance.ev.removeAllListeners();
      sockInstance.end();
    } catch (e) {}
    sockInstance = null;
  }

  try {
    if (fs.existsSync(PATHS.WA_AUTH_DIR)) {
      fs.rmSync(PATHS.WA_AUTH_DIR, { recursive: true, force: true });
      console.log('✅ WhatsApp session cleared');
    }
  } catch (err) {
    console.error('⚠️ clearWhatsAppSession error:', err.message);
  }
}

module.exports = {
  startBot,
  restartWhatsAppBot,
  getSocket: () => {
    if (sockInstance && waState.isLinked && sockInstance.user && sockInstance.user.id) {
      return sockInstance;
    }
    return null;
  },
  getLatestQR: () => latestQR,
  getPairingStatus: () => pairingStatus,
  getLinkedNumber: () => linkedNumber,
  getWaState: () => waState,
  addReaction,
  trackSentWish,
  cacheSentProtoMessage,
  clearWhatsAppSession
};

