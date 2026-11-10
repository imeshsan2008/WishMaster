const fs = require('fs');
const path = require('path');
const { PATHS, ADMIN_GROUP_JID, HOSTNAME } = require('../config/env.config');
const { safeReadJson, safeWriteJson } = require('../utils/file.util');
const { getCustomMessage, interpolateMessage } = require('../utils/text.util');
const { getAuthClient } = require('../config/google.config');
const { getTodayBirthdays, getGoogleProfilePhoto } = require('./google.service');
const { sendVoiceNote } = require('./voice.service');
const { fetchProfilePicBuffer, createFramedImage } = require('./image.service');
const {
  createBirthdayWishRecord,
  getActiveWishesLast7Days,
  getBirthdaySongUrl,
  getBotFooter,
  getWishExpiryDays,
  getSyncedContacts,
  getNextSecretLetter,
  getDbSecretLetters,
  getBirthdayMessageTemplate,
  getContactPreferenceByPhone
} = require('./db.service');

const ADMIN_APPROVAL_PHONE = '94768902513';
const ADMIN_APPROVAL_JID = `${ADMIN_APPROVAL_PHONE}@s.whatsapp.net`;

let pendingAdminApprovalQueue = [];
let activeAdminApproval = null;
let birthdaysSentToday = false;
const birthdayRetryMap = new Map();

function hasPendingAdminApproval() {
  return !!activeAdminApproval;
}

function getActiveAdminApproval() {
  return activeAdminApproval;
}

async function promptNextAdminApproval(sock) {
  if (pendingAdminApprovalQueue.length === 0) {
    activeAdminApproval = null;
    return;
  }

  activeAdminApproval = pendingAdminApprovalQueue.shift();
  const { contact } = activeAdminApproval;

  let phoneListStr = '';
  contact.phones.forEach((p, idx) => {
    phoneListStr += `${idx + 1}️⃣ +${p}\n`;
  });

  const promptMsg = 
    `🎂 *උපන්දින සුබපැතුම් අනුමැතිය අවශ්‍යයි (Multiple Numbers)* 🎂\n\n` +
    `නම: *${contact.name}*\n` +
    `මෙම පුද්ගලයා සඳහා දුරකථන අංක ${contact.phones.length}ක් හමුවිය:\n${phoneListStr}\n` +
    `කරුණාකර සුබපැතුම යැවිය යුතු අංකය තෝරා මෙම chat එකට reply කරන්න:\n` +
    `*1* - පළමු අංකයට පමණක් යැවීමට (+${contact.phones[0]})\n` +
    `*2* - දෙවන අංකයට පමණක් යැවීමට (+${contact.phones[1]})\n` +
    `*3* - ${contact.phones.length === 2 ? 'අංක දෙකටම යැවීමට' : 'සියලුම අංක වලට යැවීමට'}`;

  try {
    await sock.sendMessage(ADMIN_APPROVAL_JID, { text: promptMsg });
    console.log(`📲 Sent multi-number approval prompt to Admin (${ADMIN_APPROVAL_JID}) for ${contact.name}`);
  } catch (err) {
    console.error(`❌ Failed to send approval prompt to Admin:`, err.message);
  }
}

async function handleAdminApprovalReply(sock, senderJid, text) {
  const cleanSender = String(senderJid || '').replace(/\D/g, '');
  if (!cleanSender.endsWith(ADMIN_APPROVAL_PHONE)) {
    return false;
  }

  if (!activeAdminApproval) {
    return false;
  }

  const choice = String(text || '').trim();
  if (choice !== '1' && choice !== '2' && choice !== '3') {
    return false;
  }

  const { contact, auth, songUrl } = activeAdminApproval;
  let targetPhones = [];

  if (choice === '1') {
    targetPhones = [contact.phones[0]];
  } else if (choice === '2') {
    targetPhones = [contact.phones[1]];
  } else if (choice === '3') {
    targetPhones = contact.phones;
  }

  console.log(`✅ Admin approved sending to [${targetPhones.join(', ')}] for ${contact.name}`);

  for (const phone of targetPhones) {
    await dispatchBirthdayWishToNumber(sock, contact, phone, auth, songUrl);
  }

  await sock.sendMessage(ADMIN_APPROVAL_JID, {
    text: `✅ *සුබපැතුම සාර්ථකව යවන ලදී!*\n\n${contact.name} වෙත තෝරාගත් අංක (${targetPhones.map(p => `+${p}`).join(', ')}) ඔස්සේ සුබපැතුම යැවීම සම්පූර්ණයි!`
  }).catch(() => {});

  activeAdminApproval = null;
  if (pendingAdminApprovalQueue.length > 0) {
    await promptNextAdminApproval(sock);
  }

  return true;
}

/**
 * Dispatches a birthday wish link to a specific phone number.
 */
async function dispatchBirthdayWishToNumber(sock, contact, rawPhone, auth, songUrl) {
  let attempts = 0;
  const maxRetries = 3;
  const delay = 2000;

  const number = String(rawPhone).replace(/\D/g, '');
  if (!number) return false;
  if (!sock || !sock.user || !sock.user.id) {
    console.warn('⚠️ WhatsApp bot not connected or user ID missing. Skipping WhatsApp send to', number);
    return false;
  }
  const jid = `${number}@s.whatsapp.net`;

  // 1. Resolve Contact Photo (Google API -> Contacts.json -> DB -> WhatsApp -> Default)
  let photoUrl = contact.photo || null;
  if (!photoUrl || photoUrl.includes('/cm/')) {
    photoUrl = await resolveContactPhoto(auth, number, jid, sock);
  }

  // 2. Resolve Personalized Secret Letter & Frame Style
  const { personalMsg, assignedFrameStyle } = await resolvePersonalizedWishContent(contact.name, number);

  // 3. Generate framed image for Scratch Card
  let framedImageUrl = null;
  try {
    const profileBuffer = await fetchProfilePicBuffer(photoUrl, contact.name);
    const framedBuffer = await createFramedImage(profileBuffer, contact.name, assignedFrameStyle);
    if (framedBuffer) {
      const wishesDir = path.join(PATHS.ASSETS_DIR, 'img', 'wishes');
      fs.mkdirSync(wishesDir, { recursive: true });
      const fileName = `wish_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
      fs.writeFileSync(path.join(wishesDir, fileName), framedBuffer);
      framedImageUrl = `/assets/img/wishes/${fileName}`;
    }
  } catch (err) {
    console.warn('⚠️ Could not generate framed image for scratch card:', err.message);
  }

  if (!framedImageUrl) {
    framedImageUrl = photoUrl || '/assets/img/default_avatar.png';
  }

  // 4. Create Web-Based Wish Record in DB (Validity Period: Never)
  const wishRecord = await createBirthdayWishRecord({
    contactName: contact.name,
    phone: number,
    photoUrl,
    framedImageUrl,
    message: personalMsg,
    songUrl,
    neverExpire: true
  });

  const wishUrl = `${HOSTNAME}/wish/${wishRecord.unique_code}`;

  // 5. Compose WhatsApp Message from dynamic Editable Template
  const template = await getBirthdayMessageTemplate();
  const footer = await getBotFooter();
  const expiryDays = await getWishExpiryDays();
  let waText = template
    .replace(/\{name\}/gi, contact.name || '')
    .replace(/\{link\}/gi, wishUrl)
    .replace(/\{expiry_days\}/gi, String(expiryDays))
    .replace(/\{footer\}/gi, footer);

  if (!waText.includes(footer)) {
    waText += `\n\n${footer}`;
  }

  while (attempts < maxRetries) {
    try {
      const sentMsg = await sock.sendMessage(jid, { text: waText });

      try {
        const { trackSentWish, cacheSentProtoMessage } = require('./whatsapp.service');
        trackSentWish(sentMsg?.key?.id, jid, wishRecord);
        if (cacheSentProtoMessage && sentMsg?.key?.id && sentMsg?.message) {
          cacheSentProtoMessage(sentMsg.key.id, sentMsg.message);
        }
      } catch (e) {}

      logBirthdayEvent(jid, contact.name, 'sent', 1);

      if (ADMIN_GROUP_JID) {
        await sock.sendMessage(ADMIN_GROUP_JID, {
          text: `Birthday surprise link successfully sent to ${contact.name} (${number}): ${wishUrl}`
        }).catch(() => {});
      }

      console.log(`✅ Sent surprise birthday page link to ${contact.name} (${number})`);

      // Dispatch SMS via Text.lk if enabled
      try {
        const { sendBirthdaySms, getTextLkConfig } = require('./sms.service');
        const smsConfig = await getTextLkConfig();
        if (smsConfig.autoSend && smsConfig.token) {
          sendBirthdaySms({ contact: { ...contact, phone: number }, wishUrl }).catch(err => {
            console.error('⚠️ Birthday SMS error:', err.message);
          });
        }
      } catch (smsErr) {
        console.warn('⚠️ SMS dispatch check error:', smsErr.message);
      }

      return true;
    } catch (err) {
      attempts++;
      console.error(`❌ Birthday send failed (${attempts}/${maxRetries}) → ${contact.name} (${number}):`, err.message || err);

      if (attempts < maxRetries) {
        await new Promise(res => setTimeout(res, delay));
      } else {
        logBirthdayEvent(jid, contact.name, 'failed', attempts);
        
        // WhatsApp failed: Dispatch SMS fallback
        try {
          const { sendBirthdaySms, getTextLkConfig } = require('./sms.service');
          const smsConfig = await getTextLkConfig();
          if (smsConfig.token) {
            console.log(`📲 WhatsApp failed, dispatching Text.lk SMS fallback to ${number}`);
            await sendBirthdaySms({ contact: { ...contact, phone: number }, wishUrl });
          }
        } catch (smsErr) {}
      }
    }
  }
  return false;
}

/**
 * Resolves personalized secret letter and frame style for a specific contact.
 */
async function resolvePersonalizedWishContent(contactName, phone) {
  const pref = await getContactPreferenceByPhone(phone);
  let personalMsg = '';
  let assignedFrameStyle = null;

  if (pref) {
    if (pref.assigned_frame_id && pref.assigned_frame_id !== 'default') {
      assignedFrameStyle = String(pref.assigned_frame_id);
    }

    if (pref.letter_type === 'custom' && pref.custom_letter_text) {
      personalMsg = pref.custom_letter_text.replace(/\{name\}/gi, contactName || 'Friend');
    } else if (pref.letter_type === 'saved' && pref.saved_letter_id) {
      try {
        const lettersData = await getDbSecretLetters();
        const found = (lettersData.letters || []).find(l => l.id === pref.saved_letter_id);
        if (found) {
          personalMsg = (found.text || '').replace(/\{name\}/gi, contactName || 'Friend');
        }
      } catch (e) {}
    }
  }

  if (!personalMsg) {
    personalMsg = await getNextSecretLetter(contactName);
  }

  return { personalMsg, assignedFrameStyle };
}

/**
 * Resolves contact photo with multi-level fallback:
 * 1. Google People API (live)
 * 2. Cached Contacts.json
 * 3. Supabase synced contacts table
 * 4. WhatsApp live profile picture
 */
async function resolveContactPhoto(auth, number, jid, sock) {
  const cleanNumber = (number || '').replace(/\D/g, '');
  if (!cleanNumber) return null;

  // 1. Google People API
  if (auth) {
    try {
      const googleData = await getGoogleProfilePhoto(auth, cleanNumber);
      if (googleData?.photo && !googleData.photo.includes('/cm/')) {
        return googleData.photo;
      }
    } catch (e) {}
  }

  // 2. Cached Contacts.json
  try {
    const cachedContacts = safeReadJson(PATHS.CONTACTS_CACHE, []);
    if (Array.isArray(cachedContacts)) {
      const found = cachedContacts.find(c => {
        if (!c.phones || !Array.isArray(c.phones)) return false;
        return c.phones.some(p => {
          const ph = p.replace(/\D/g, '');
          return ph && (ph.includes(cleanNumber) || cleanNumber.includes(ph));
        });
      });
      if (found?.photo && !found.photo.includes('/cm/')) {
        return found.photo;
      }
    }
  } catch (e) {}

  // 3. Supabase DB synced contacts
  try {
    const dbContacts = await getSyncedContacts();
    if (Array.isArray(dbContacts)) {
      const found = dbContacts.find(c => {
        const ph = (c.phone || '').replace(/\D/g, '');
        return ph && (ph.includes(cleanNumber) || cleanNumber.includes(ph));
      });
      const dbPhoto = found?.photo_url || found?.photo;
      if (dbPhoto && !dbPhoto.includes('/cm/')) {
        return dbPhoto;
      }
    }
  } catch (e) {}

  // 4. WhatsApp Profile Picture via Baileys
  if (sock && jid) {
    try {
      const waPhoto = await sock.profilePictureUrl(jid, 'image');
      if (waPhoto) return waPhoto;
    } catch (e) {}
  }

  return null;
}

function logBirthdayEvent(jid, name, status, attempt) {
  let logs = safeReadJson(PATHS.BIRTHDAY_LOG, []);
  if (!Array.isArray(logs)) logs = [];

  logs.push({
    jid,
    name,
    status,
    attempt,
    timestamp: new Date().toISOString()
  });

  safeWriteJson(PATHS.BIRTHDAY_LOG, logs);
}

function getBirthdayLogs() {
  return safeReadJson(PATHS.BIRTHDAY_LOG, []);
}

function clearOldRetries() {
  const now = Date.now();
  let removed = 0;
  for (const [jid, data] of birthdayRetryMap.entries()) {
    if (now - data.timestamp > 24 * 60 * 60 * 1000) {
      birthdayRetryMap.delete(jid);
      removed++;
    }
  }
  return removed;
}

/**
 * Helper to get current Date parts in Asia/Colombo timezone.
 */
function getColomboDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(new Date());
  const year = parseInt(parts.find(p => p.type === 'year').value, 10);
  const month = parseInt(parts.find(p => p.type === 'month').value, 10);
  const day = parseInt(parts.find(p => p.type === 'day').value, 10);
  return { year, month, day };
}

/**
 * Checks whether a birthday wish has already been dispatched to this contact today (Asia/Colombo).
 * Guarantees zero duplicate wishes are sent even if the server restarts or catches up.
 */
async function hasWishBeenSentToContactToday(phone, name) {
  const { year, month, day } = getColomboDateParts();
  const mStr = String(month).padStart(2, '0');
  const dStr = String(day).padStart(2, '0');
  const colomboTodayStart = new Date(`${year}-${mStr}-${dStr}T00:00:00+05:30`).toISOString();

  const { getSql, isDbConnected } = require('../config/db');
  const sql = getSql();

  const cleanPhone = String(phone || '').replace(/\D/g, '').slice(-9);

  if (isDbConnected() && sql) {
    try {
      const rows = await sql`
        SELECT id FROM birthday_wishes
        WHERE (
          (${cleanPhone} <> '' AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 9) = ${cleanPhone})
          OR (${name || ''} <> '' AND LOWER(TRIM(contact_name)) = LOWER(TRIM(${name})))
        )
        AND created_at >= ${colomboTodayStart}
        LIMIT 1;
      `;
      if (rows.length > 0) return true;
    } catch (err) {
      console.warn('⚠️ Error checking today wish in DB:', err.message);
    }
  }

  // Fallback to local store
  const { getLocalStore } = require('./db.service');
  const store = getLocalStore();
  const startMs = new Date(`${year}-${mStr}-${dStr}T00:00:00+05:30`).getTime();
  return (store.birthday_wishes || []).some(w => {
    const wPhone = String(w.phone || '').replace(/\D/g, '').slice(-9);
    const matchPhone = cleanPhone && wPhone === cleanPhone;
    const matchName = name && (w.contact_name || '').toLowerCase().trim() === (name || '').toLowerCase().trim();
    return (matchPhone || matchName) && new Date(w.created_at).getTime() >= startMs;
  });
}

/**
 * Checks and sends web-page based surprise birthday wishes for all contacts having a birthday today.
 */
async function sendTodaysBirthdays(sock, senderId = null, forceAll = false) {
  if (!sock) {
    console.error('❌ Cannot send birthdays: WhatsApp socket is not connected');
    return 'WhatsApp not connected';
  }

  try {
    const auth = await getAuthClient();
    if (!auth) {
      console.warn('⚠️ Google authentication not configured');
      return 'Google Auth required';
    }

    const birthdays = await getTodayBirthdays(auth);

    if (!birthdays.length) {
      const msg = '🎉 No birthdays today.';
      console.log(msg);
      if (senderId) {
        await sock.sendMessage(senderId, { text: msg });
      }
      return msg;
    }

    console.log(`🎂 Found ${birthdays.length} birthday(s) today! Checking dispatch status...`);
    const songUrl = await getBirthdaySongUrl();
    let sentCount = 0;

    for (const contact of birthdays) {
      const number = contact.phone || (contact.phones && contact.phones[0]);

      // Anti-duplication check: Skip if already sent today
      if (!forceAll) {
        const alreadySent = await hasWishBeenSentToContactToday(number, contact.name);
        if (alreadySent) {
          console.log(`⏭️ [Today's Birthdays] Wish already sent today to ${contact.name} (${number || 'no phone'}), skipping.`);
          continue;
        }
      }

      if (contact.phones && contact.phones.length > 1) {
        console.log(`⚠️ Contact ${contact.name} has multiple numbers (${contact.phones.join(', ')}). Queuing for Admin approval via WhatsApp.`);
        pendingAdminApprovalQueue.push({ contact, auth, songUrl });
      } else {
        if (number) {
          await dispatchBirthdayWishToNumber(sock, contact, number, auth, songUrl);
          sentCount++;
        }
      }
    }

    if (pendingAdminApprovalQueue.length > 0 && !activeAdminApproval) {
      await promptNextAdminApproval(sock);
    }

    birthdaysSentToday = true;
    return `Processed ${birthdays.length} birthday(s) (Sent ${sentCount} new wish(es))`;
  } catch (err) {
    console.error('❌ Error sending birthdays:', err.message || err);
    throw err;
  }
}

let isCatchUpRunning = false;
/**
 * Catch-up trigger: Automatically checks if any today's birthdays are unsent
 * and dispatches them safely. Safe to call on boot, WhatsApp connect, or periodically.
 */
async function checkAndCatchUpTodaysBirthdays(sock) {
  if (isCatchUpRunning || !sock) return;
  isCatchUpRunning = true;
  try {
    console.log('🔍 [Catch-up] Checking if today\'s birthdays were sent...');
    const result = await sendTodaysBirthdays(sock, null, false);
    console.log('✅ [Catch-up] Check complete:', result);
  } catch (err) {
    console.warn('⚠️ [Catch-up] Error during check:', err.message);
  } finally {
    isCatchUpRunning = false;
  }
}

/**
 * Manually forces sending a birthday surprise link to a specific number.
 */
async function sendForcedBirthdayMessage(sock, senderId, contactName = 'there') {
  if (!sock || !sock.user || !sock.user.id) {
    throw new Error('WhatsApp bot is not connected or session not paired yet. Please link WhatsApp in Settings or scan QR.');
  }

  const number = senderId.replace(/\D/g, '');
  const jid = `${number}@s.whatsapp.net`;

  // 1. Resolve Contact Photo (Google API -> Contacts.json -> DB -> WhatsApp -> Default)
  let auth = null;
  try {
    auth = await getAuthClient();
  } catch (err) {}

  const photoUrl = await resolveContactPhoto(auth, number, jid, sock);

  const songUrl = await getBirthdaySongUrl();

  // 1. Resolve Contact Personalized Content (Secret Letter & Frame Style)
  const { personalMsg, assignedFrameStyle } = await resolvePersonalizedWishContent(contactName, number);

  // Generate framed birthday image for the Scratch-to-Reveal card
  let framedImageUrl = null;
  try {
    const profileBuffer = await fetchProfilePicBuffer(photoUrl, contactName);
    const framedBuffer = await createFramedImage(profileBuffer, contactName, assignedFrameStyle);
    if (framedBuffer) {
      const wishesDir = path.join(PATHS.ASSETS_DIR, 'img', 'wishes');
      fs.mkdirSync(wishesDir, { recursive: true });
      const fileName = `wish_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
      fs.writeFileSync(path.join(wishesDir, fileName), framedBuffer);
      framedImageUrl = `/assets/img/wishes/${fileName}`;
    }
  } catch (err) {
    console.warn('⚠️ Could not generate framed image for scratch card:', err.message);
  }

  if (!framedImageUrl) {
    framedImageUrl = photoUrl || '/assets/img/default_avatar.png';
  }

  // 2. Create Web-Based Wish Record in DB (Validity Period: Never)
  const wishRecord = await createBirthdayWishRecord({
    contactName,
    phone: number,
    photoUrl,
    framedImageUrl,
    message: personalMsg,
    songUrl,
    neverExpire: true
  });

  const wishUrl = `${HOSTNAME}/wish/${wishRecord.unique_code}`;

  // 3. Compose WhatsApp Message from dynamic Editable Template
  const template = await getBirthdayMessageTemplate();
  const footer = await getBotFooter();
  const expiryDays = await getWishExpiryDays();
  let waText = template
    .replace(/\{name\}/gi, contactName)
    .replace(/\{link\}/gi, wishUrl)
    .replace(/\{expiry_days\}/gi, String(expiryDays))
    .replace(/\{footer\}/gi, footer);

  if (!waText.includes(footer)) {
    waText += `\n\n${footer}`;
  }

  const sentMsg = await sock.sendMessage(jid, { text: waText });
  try {
    const { trackSentWish, cacheSentProtoMessage } = require('./whatsapp.service');
    trackSentWish(sentMsg?.key?.id, jid, wishRecord);
    if (cacheSentProtoMessage && sentMsg?.key?.id && sentMsg?.message) {
      cacheSentProtoMessage(sentMsg.key.id, sentMsg.message);
    }
  } catch (e) {}

  // Dispatch SMS via Text.lk if enabled
  try {
    const { sendBirthdaySms, getTextLkConfig } = require('./sms.service');
    const smsConfig = await getTextLkConfig();
    if (smsConfig.autoSend && smsConfig.token) {
      sendBirthdaySms({ contact: { name: contactName, phone: number }, wishUrl }).catch(() => {});
    }
  } catch (e) {}

  console.log(`✅ Sent forced surprise birthday page to ${jid}`);
  return { type: 'web-surprise', wishUrl, unique_code: wishRecord.unique_code };
}

module.exports = {
  getBirthdaysSentToday: () => birthdaysSentToday,
  setBirthdaysSentToday: (val) => { birthdaysSentToday = val; },
  logBirthdayEvent,
  getBirthdayLogs,
  clearOldRetries,
  sendTodaysBirthdays,
  sendForcedBirthdayMessage,
  getActiveWishesLast7Days,
  hasPendingAdminApproval,
  handleAdminApprovalReply,
  promptNextAdminApproval,
  hasWishBeenSentToContactToday,
  checkAndCatchUpTodaysBirthdays
};
