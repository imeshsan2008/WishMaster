const fs = require('fs');
const path = require('path');
const { getSocket, getLinkedNumber } = require('../services/whatsapp.service');
const {
  sendTodaysBirthdays,
  sendForcedBirthdayMessage,
  getBirthdaysSentToday,
  setBirthdaysSentToday,
  getActiveWishesLast7Days
} = require('../services/birthday.service');
const {
  updateFestiveConfig,
  sendFestiveBroadcast,
  getFestiveConfig,
  getFestiveTemplates,
  saveFestiveTemplate,
  deleteFestiveTemplate,
  sendFestiveTestMessage
} = require('../services/festive.service');
const {
  getWishByCode,
  markWishOpened,
  markWishStepsCompleted,
  getBirthdaySongUrl,
  setBirthdaySongUrl,
  getBotFooter,
  saveBotFooter,
  getWishExpiryDays,
  saveWishExpiryDays,
  getAdminPassword,
  setAdminPassword,
  syncContactsToDb,
  getDbSecretLetters,
  saveDbSecretLetters,
  getBirthdayMessageTemplate,
  saveBirthdayMessageTemplate,
  DEFAULT_MESSAGE_TEMPLATE,
  getContactPreferences,
  getContactPreferenceByPhone,
  saveContactPreference
} = require('../services/db.service');
const { getAuthClient } = require('../config/google.config');
const { listContacts } = require('../services/google.service');
const { ADMIN_GROUP_JID, PATHS } = require('../config/env.config');

async function sendBirthdayManual(req, res) {
  const sock = getSocket();
  if (!sock) {
    return res.status(503).json({ ok: false, error: 'WhatsApp not connected' });
  }

  if (getBirthdaysSentToday()) {
    return res.status(429).json({ ok: false, error: 'Birthdays already sent today' });
  }

  res.json({ ok: true, message: 'Birthday check initiated' });

  setTimeout(async () => {
    try {
      if (ADMIN_GROUP_JID) {
        await sock.sendMessage(ADMIN_GROUP_JID, {
          text: `⏳ Checking for today's birthdays... > webEndpoint`
        }).catch(() => {});
      }
      await sendTodaysBirthdays(sock, ADMIN_GROUP_JID);
    } catch (err) {
      console.error('❌ Error executing birthday check:', err.message || err);
    }
  }, 1000);
}

async function sendBirthdayForce(req, res) {
  const sock = getSocket();
  if (!sock) {
    return res.status(503).json({ success: false, error: 'WhatsApp not connected' });
  }

  try {
    const { senderId, contactName } = req.params;
    const result = await sendForcedBirthdayMessage(sock, senderId, contactName);
    res.json({
      success: true,
      message: `Birthday surprise message sent to ${senderId}`,
      result
    });
  } catch (err) {
    console.error('❌ sendBirthdayForce error:', err.message || err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

async function sendFestiveManual(req, res) {
  const sock = getSocket();
  if (!sock) {
    return res.status(503).json({ ok: false, message: 'WhatsApp not connected' });
  }

  res.json({ ok: true, message: '✅ Festive messages will be sent shortly!' });

  setTimeout(async () => {
    try {
      await sendFestiveBroadcast(sock, ADMIN_GROUP_JID);
      console.log('🎉 Festive broadcast finished!');
    } catch (err) {
      console.error('❌ Festive broadcast error:', err.message || err);
    }
  }, 2000);
}

function getFestiveConfigApi(req, res) {
  try {
    const config = getFestiveConfig();
    const templates = getFestiveTemplates();
    res.json({ ok: true, config, templates });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

function getFestiveTemplatesApi(req, res) {
  try {
    const templates = getFestiveTemplates();
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function saveFestiveTemplateApi(req, res) {
  try {
    const { id, title, caption, image, withImage } = req.body;
    const saved = saveFestiveTemplate({ id, title, caption, image, withImage });
    res.json({ ok: true, template: saved });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

function deleteFestiveTemplateApi(req, res) {
  try {
    const { id } = req.params;
    deleteFestiveTemplate(id);
    res.json({ ok: true, message: 'Template removed' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function sendFestiveTestApi(req, res) {
  const sock = getSocket();
  if (!sock) {
    return res.status(503).json({ ok: false, error: 'WhatsApp not connected' });
  }

  try {
    const { targetNumber, caption, image } = req.body;
    const result = await sendFestiveTestMessage(sock, targetNumber, caption, image);
    res.json({
      ok: true,
      message: `Test message sent to ${result.recipient}`,
      recipient: result.recipient
    });
  } catch (err) {
    console.error('❌ sendFestiveTestApi error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

function updateFestive(req, res) {
  try {
    const { caption } = req.body;
    const imagePath = req.file ? `assets/img/${req.file.filename}` : null;

    updateFestiveConfig(caption, imagePath);
    res.json({ message: '✅ Festive configuration updated successfully!' });
  } catch (err) {
    console.error('❌ Error updating festive config:', err.message);
    res.status(500).json({ message: 'Failed to update festive config' });
  }
}

function getBirthdaysSentTodayStatus(req, res) {
  res.json({ birthdaysSentToday: getBirthdaysSentToday() });
}

function clearBirthdaysSentTodayStatus(req, res) {
  setBirthdaysSentToday(false);
  res.json({ birthdaysSentToday: false });
}

// ======================== WEB-BASED WISH HANDLERS ========================

function renderWishPage(req, res) {
  res.sendFile(path.join(PATHS.TEMPLATES_DIR, 'wish.html'));
}

async function getWishApi(req, res) {
  const { code } = req.params;
  const wish = await getWishByCode(code);
  if (!wish) {
    return res.status(404).json({ error: 'Wish not found or invalid' });
  }

  // Always use the latest active song URL configured in Admin Settings
  const currentSongUrl = await getBirthdaySongUrl();
  wish.song_url = currentSongUrl || '/assets/voice/voice.ogg';

  // Ensure framed_image_url is generated and present for the scratch card
  if (!wish.framed_image_url) {
    try {
      const { fetchProfilePicBuffer, createFramedImage } = require('../services/image.service');
      const photoUrl = wish.photo_url;
      const buf = await fetchProfilePicBuffer(photoUrl, wish.contact_name);
      const framed = await createFramedImage(buf, wish.contact_name);
      if (framed) {
        const wishesDir = path.join(PATHS.ASSETS_DIR, 'img', 'wishes');
        fs.mkdirSync(wishesDir, { recursive: true });
        const fileName = `wish_${wish.unique_code}.png`;
        fs.writeFileSync(path.join(wishesDir, fileName), framed);
        wish.framed_image_url = `/assets/img/wishes/${fileName}`;
      }
    } catch (e) {
      console.warn('⚠️ Could not generate on-the-fly framed image:', e.message);
    }
  }

  const isExpired = new Date().getTime() > new Date(wish.expires_at).getTime();
  const botFooter = await getBotFooter();
  const expiryDays = await getWishExpiryDays();
  res.json({
    ...wish,
    sender_number: getLinkedNumber() || '',
    isExpired,
    bot_footer: botFooter,
    expiry_days: expiryDays
  });
}

async function completeWishApi(req, res) {
  try {
    const { code } = req.params;
    const isPreview = req.query.preview === 'admin';
    if (!isPreview) {
      await markWishStepsCompleted(code, true);
    }
    res.json({ success: true, message: 'Wish steps marked as completed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function resetWishApi(req, res) {
  try {
    const { code } = req.params;
    await markWishStepsCompleted(code, false);
    res.json({ success: true, message: 'Wish steps reset' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getGeneralSettingsApi(req, res) {
  try {
    const botFooter = await getBotFooter();
    const expiryDays = await getWishExpiryDays();
    res.json({ success: true, bot_footer: botFooter, wish_expiry_days: expiryDays });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function saveGeneralSettingsApi(req, res) {
  try {
    const { bot_footer, wish_expiry_days } = req.body;
    if (bot_footer !== undefined) {
      await saveBotFooter(bot_footer);
    }
    if (wish_expiry_days !== undefined) {
      await saveWishExpiryDays(wish_expiry_days);
    }
    const updatedFooter = await getBotFooter();
    const updatedDays = await getWishExpiryDays();
    res.json({ success: true, bot_footer: updatedFooter, wish_expiry_days: updatedDays });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function openWishApi(req, res) {
  const { code } = req.params;
  const isPreview = req.query.preview === 'admin' || req.headers['x-admin-preview'] === 'true';

  // Admin preview mode: Do NOT count or mark as opened
  if (isPreview) {
    return res.json({ ok: true, preview: true, message: 'Admin preview - view not counted' });
  }

  const wish = await markWishOpened(code);
  if (!wish) {
    return res.status(404).json({ error: 'Wish not found' });
  }
  res.json({ ok: true, wish });
}

async function getActiveWishesApi(req, res) {
  try {
    const list = await getActiveWishesLast7Days();
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getSongUrlApi(req, res) {
  const url = await getBirthdaySongUrl();
  res.json({ songUrl: url });
}

async function setSongUrlApi(req, res) {
  const { songUrl } = req.body;
  if (!songUrl) return res.status(400).json({ error: 'Missing songUrl' });
  await setBirthdaySongUrl(songUrl);
  res.json({ ok: true, songUrl });
}

async function uploadSongApi(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No audio file uploaded.' });
    }

    const songUrl = `/assets/voice/${req.file.filename}`;
    await setBirthdaySongUrl(songUrl);

    // If it's an ogg file, also update default voice.ogg
    const ext = path.extname(req.file.filename).toLowerCase();
    if (ext === '.ogg') {
      try {
        const dest = path.join(PATHS.ASSETS_DIR, 'voice', 'voice.ogg');
        fs.copyFileSync(req.file.path, dest);
        console.log('🔄 Also updated default voice.ogg with uploaded ogg');
      } catch (e) {}
    }

    console.log(`✅ Birthday celebration song uploaded successfully: ${songUrl}`);
    res.json({
      ok: true,
      success: true,
      songUrl,
      filename: req.file.originalname,
      message: 'Birthday celebration song uploaded and updated successfully!'
    });
  } catch (err) {
    console.error('❌ uploadSongApi error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function syncContactsApi(req, res) {
  try {
    const auth = await getAuthClient(req, res);
    if (!auth) return;
    const contacts = await listContacts(auth);
    const count = await syncContactsToDb(contacts);
    res.json({ ok: true, syncedCount: count });
  } catch (err) {
    console.error('❌ syncContactsApi error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

async function adminLoginApi(req, res) {
  const { password } = req.body;
  const currentPassword = await getAdminPassword();
  if (password === currentPassword) {
    return res.json({ ok: true, message: 'Authentication successful' });
  }
  return res.status(401).json({ ok: false, message: 'Invalid password' });
}

async function changeAdminPasswordApi(req, res) {
  const { currentPassword, newPassword } = req.body;
  const stored = await getAdminPassword();
  if (currentPassword !== stored) {
    return res.status(401).json({ ok: false, message: 'Incorrect current password' });
  }
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ ok: false, message: 'New password must be at least 4 digits' });
  }
  await setAdminPassword(newPassword);
  res.json({ ok: true, message: 'Password updated successfully' });
}

async function getSecretLettersApi(req, res) {
  try {
    const data = await getDbSecretLetters();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function saveSecretLettersApi(req, res) {
  try {
    const { letters, currentIndex } = req.body;
    if (!Array.isArray(letters)) {
      return res.status(400).json({ error: 'letters must be an array' });
    }
    const data = {
      currentIndex: typeof currentIndex === 'number' ? currentIndex : 0,
      letters: letters.map((l, idx) => ({
        id: l.id || `letter_${Date.now()}_${idx}`,
        title: l.title || `Letter ${idx + 1}`,
        text: typeof l === 'string' ? l : (l.text || '')
      }))
    };
    await saveDbSecretLetters(data);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function importSecretLettersApi(req, res) {
  try {
    let { lettersJson } = req.body;
    if (typeof lettersJson === 'string') {
      try {
        lettersJson = JSON.parse(lettersJson);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON format' });
      }
    }

    if (!Array.isArray(lettersJson) && typeof lettersJson === 'object' && Array.isArray(lettersJson.letters)) {
      lettersJson = lettersJson.letters;
    }

    if (!Array.isArray(lettersJson)) {
      return res.status(400).json({ error: 'Expected JSON array of letters' });
    }

    const current = await getDbSecretLetters();
    const formatted = lettersJson.map((item, idx) => {
      if (typeof item === 'string') {
        return {
          id: `letter_${Date.now()}_${idx}`,
          title: `Letter ${idx + 1}`,
          text: item.trim()
        };
      }
      return {
        id: item.id || `letter_${Date.now()}_${idx}`,
        title: item.title || `Letter ${idx + 1}`,
        text: (item.text || item.message || '').trim()
      };
    }).filter(l => l.text.length > 0);

    current.letters = formatted;
    current.currentIndex = 0;
    await saveDbSecretLetters(current);

    res.json({ ok: true, count: formatted.length, letters: formatted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteSecretLetterApi(req, res) {
  try {
    const { id } = req.params;
    const current = await getDbSecretLetters();
    if (current.letters.length <= 1) {
      return res.status(400).json({ error: 'At least one secret letter must remain.' });
    }
    current.letters = current.letters.filter(l => l.id !== id);
    if (current.currentIndex >= current.letters.length) {
      current.currentIndex = 0;
    }
    await saveDbSecretLetters(current);
    res.json({ ok: true, message: 'Letter removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ======================== MESSAGE TEMPLATE API ========================

async function getMessageTemplateApi(req, res) {
  try {
    const template = await getBirthdayMessageTemplate();
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function saveMessageTemplateApi(req, res) {
  try {
    const { template } = req.body;
    if (!template || !template.trim()) {
      return res.status(400).json({ success: false, error: 'Template text cannot be empty' });
    }
    await saveBirthdayMessageTemplate(template.trim());
    res.json({ success: true, message: 'Message template saved successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function resetMessageTemplateApi(req, res) {
  try {
    await saveBirthdayMessageTemplate(DEFAULT_MESSAGE_TEMPLATE);
    res.json({ success: true, template: DEFAULT_MESSAGE_TEMPLATE, message: 'Message template reset to default!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ======================== CONTACT PERSONALIZATION PREFERENCES API ========================

async function getContactPreferencesApi(req, res) {
  try {
    const preferences = await getContactPreferences();
    res.json({ success: true, preferences });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getSingleContactPreferenceApi(req, res) {
  try {
    const { phone } = req.params;
    const pref = await getContactPreferenceByPhone(phone);
    res.json({ success: true, preference: pref });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function saveContactPreferenceApi(req, res) {
  try {
    const { phone, name, letter_type, saved_letter_id, custom_letter_text, assigned_frame_id } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }
    const saved = await saveContactPreference(phone, {
      name,
      letter_type,
      saved_letter_id,
      custom_letter_text,
      assigned_frame_id
    });
    res.json({ success: true, preference: saved, message: `Preferences saved for ${name || phone}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ======================== SMS CENTER & TEXT.LK API ========================

const {
  getTextLkConfig,
  saveTextLkConfig,
  getSmsCreditsStats,
  getSmsHistoryList,
  sendSms,
  sendBirthdaySms
} = require('../services/sms.service');

async function getSmsConfigApi(req, res) {
  try {
    const config = await getTextLkConfig();
    const credits = await getSmsCreditsStats();
    res.json({ success: true, config, credits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function saveSmsConfigApi(req, res) {
  try {
    const { token, senderId, template, autoSend } = req.body;
    await saveTextLkConfig({ token, senderId, template, autoSend });
    const updated = await getTextLkConfig();
    res.json({ success: true, config: updated, message: 'SMS settings saved successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getSmsHistoryApi(req, res) {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const history = await getSmsHistoryList(limit);
    const credits = await getSmsCreditsStats();
    res.json({ success: true, history, credits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function sendCustomSmsApi(req, res) {
  try {
    const { recipientPhone, recipientName, message } = req.body;
    if (!recipientPhone || !message) {
      return res.status(400).json({ success: false, error: 'Recipient phone and message are required' });
    }
    const result = await sendSms({ recipientPhone, recipientName, message });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function sendBirthdaySmsManualApi(req, res) {
  try {
    const { phone } = req.params;
    const { name } = req.body || {};
    const cleanPhone = String(phone).replace(/\D/g, '');

    const { getLatestWishByPhone, createBirthdayWishRecord } = require('../services/db.service');
    let wish = await getLatestWishByPhone(cleanPhone);
    if (!wish) {
      wish = await createBirthdayWishRecord({
        contactName: name || '',
        phone: cleanPhone,
        message: 'Wishing you endless health, radiant happiness, and joy!',
        neverExpire: true
      });
    } else {
      // Ensure existing wish is set to Never Expire
      const { getSql, isDbConnected } = require('../config/db');
      const sql = getSql();
      if (isDbConnected() && sql && wish.unique_code) {
        try {
          await sql`UPDATE birthday_wishes SET expires_at = '2099-12-31 23:59:59' WHERE unique_code = ${wish.unique_code}`;
        } catch (e) {}
      }
    }

    const { HOSTNAME } = require('../config/env.config');
    const wishUrl = `${HOSTNAME}/wish/${wish.unique_code}`;

    const result = await sendBirthdaySms({
      contact: { name: name || wish.contact_name, phone: cleanPhone },
      wishUrl
    });

    res.json({ success: result.success, error: result.error, wishUrl, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function sendWishWithOptionsApi(req, res) {
  try {
    const { name, phones, channels } = req.body;
    if (!phones || (Array.isArray(phones) && phones.length === 0)) {
      return res.status(400).json({ success: false, error: 'At least one phone number is required.' });
    }

    const selectedChannels = Array.isArray(channels) && channels.length > 0 ? channels : ['whatsapp'];
    const phoneList = Array.isArray(phones) ? phones : [phones];
    const contactName = name || 'Friend';

    const results = {
      whatsapp: [],
      sms: []
    };

    const sock = getSocket();
    const { sendForcedBirthdayMessage } = require('../services/birthday.service');
    const { sendBirthdaySms, getTextLkConfig } = require('../services/sms.service');
    const { getLatestWishByPhone, createBirthdayWishRecord, updateWishDeliveryStatus } = require('../services/db.service');
    const { HOSTNAME } = require('../config/env.config');
    const smsConfig = await getTextLkConfig();

    for (const rawPhone of phoneList) {
      const cleanPhone = String(rawPhone).replace(/\D/g, '');
      if (!cleanPhone) continue;

      let wishUrl = null;
      let wishCode = null;

      // 1. WhatsApp Dispatch
      if (selectedChannels.includes('whatsapp')) {
        if (!sock || !sock.user || !sock.user.id) {
          results.whatsapp.push({
            phone: cleanPhone,
            success: false,
            error: 'WhatsApp bot not linked/connected. Please link WhatsApp in Settings or scan QR.'
          });
          await updateWishDeliveryStatus({ phone: cleanPhone, waStatus: 'failed' });
        } else {
          try {
            const waResult = await sendForcedBirthdayMessage(sock, cleanPhone, contactName);
            wishUrl = waResult?.wishUrl;
            wishCode = waResult?.unique_code;
            results.whatsapp.push({
              phone: cleanPhone,
              success: true,
              wishUrl,
              message: 'WhatsApp surprise birthday message dispatched'
            });
            await updateWishDeliveryStatus({ uniqueCode: wishCode, phone: cleanPhone, waStatus: 'sent' });
          } catch (waErr) {
            results.whatsapp.push({
              phone: cleanPhone,
              success: false,
              error: waErr.message || 'WhatsApp send failed'
            });
            await updateWishDeliveryStatus({ phone: cleanPhone, waStatus: 'failed' });
          }
        }
      }

      // 2. Text.lk SMS Dispatch
      if (selectedChannels.includes('sms')) {
        if (!smsConfig.token) {
          results.sms.push({
            phone: cleanPhone,
            success: false,
            error: 'Text.lk API token not configured in SMS Center'
          });
        } else {
          try {
            if (!wishUrl) {
              let wish = await getLatestWishByPhone(cleanPhone);
              if (!wish) {
                wish = await createBirthdayWishRecord({
                  contactName,
                  phone: cleanPhone,
                  message: 'Wishing you endless health, radiant happiness, and prosperity!',
                  neverExpire: true
                });
              }
              wishUrl = `${HOSTNAME}/wish/${wish.unique_code}`;
              wishCode = wish.unique_code;
            }

            const smsRes = await sendBirthdaySms({
              contact: { name: contactName, phone: cleanPhone },
              wishUrl
            });

            results.sms.push({
              phone: cleanPhone,
              success: smsRes.success,
              credits: smsRes.creditsUsed || (smsRes.success ? 1 : 0),
              message: smsRes.message,
              error: smsRes.error
            });

            await updateWishDeliveryStatus({
              uniqueCode: wishCode,
              phone: cleanPhone,
              smsStatus: smsRes.success ? 'success' : 'failed'
            });
          } catch (smsErr) {
            results.sms.push({
              phone: cleanPhone,
              success: false,
              error: smsErr.message || 'SMS send failed'
            });
            await updateWishDeliveryStatus({ phone: cleanPhone, smsStatus: 'failed' });
          }
        }
      }
    }

    const hasAnySuccess = results.whatsapp.some(r => r.success) || results.sms.some(r => r.success);
    res.json({
      success: hasAnySuccess,
      results,
      message: hasAnySuccess ? 'Wish dispatch completed' : 'All dispatch channels failed'
    });
  } catch (err) {
    console.error('❌ sendWishWithOptionsApi error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function exportBackupZipApi(req, res) {
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();

    const {
      getLocalStore,
      getDbSecretLetters,
      getDbFrameStyles,
      getContactPreferences,
      getBirthdayMessageTemplate,
      getBotFooter,
      getWishExpiryDays,
      getBirthdaySongUrl,
      getFestiveCampaigns
    } = require('../services/db.service');
    const { getFestiveTemplates, getFestiveConfig } = require('../services/festive.service');
    const { getTextLkConfig, getSmsCreditsStats } = require('../services/sms.service');

    const backupData = {
      version: '4.0',
      exported_at: new Date().toISOString(),
      admin_settings: {
        bot_footer: await getBotFooter(),
        wish_expiry_days: await getWishExpiryDays(),
        birthday_song_url: await getBirthdaySongUrl(),
        birthday_message_template: await getBirthdayMessageTemplate()
      },
      secret_letters: await getDbSecretLetters(),
      frame_styles: await getDbFrameStyles(),
      contact_preferences: await getContactPreferences(),
      festive: {
        config: getFestiveConfig(),
        templates: getFestiveTemplates(),
        campaigns: await getFestiveCampaigns()
      },
      sms: {
        config: await getTextLkConfig(),
        credits: await getSmsCreditsStats()
      },
      fallback_store: getLocalStore()
    };

    zip.addFile('wishmaster_config.json', Buffer.from(JSON.stringify(backupData, null, 2), 'utf8'));

    // Add all Frame Images (assets/img/)
    const imgDir = path.join(PATHS.ASSETS_DIR, 'img');
    if (fs.existsSync(imgDir)) {
      const imgFiles = fs.readdirSync(imgDir);
      for (const f of imgFiles) {
        const fullPath = path.join(imgDir, f);
        if (fs.statSync(fullPath).isFile() && (f.startsWith('frame') || f.startsWith('festive_') || f.endsWith('.png') || f.endsWith('.jpg'))) {
          zip.addLocalFile(fullPath, 'assets/img');
        }
      }
    }

    // Add all Voice & Song Audio Files (assets/voice/)
    const voiceDir = path.join(PATHS.ASSETS_DIR, 'voice');
    if (fs.existsSync(voiceDir)) {
      const voiceFiles = fs.readdirSync(voiceDir);
      for (const f of voiceFiles) {
        const fullPath = path.join(voiceDir, f);
        if (fs.statSync(fullPath).isFile()) {
          zip.addLocalFile(fullPath, 'assets/voice');
        }
      }
    }

    const zipBuffer = zip.toBuffer();
    const fileName = `wishmaster_backup_${new Date().toISOString().slice(0, 10)}.zip`;

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': zipBuffer.length
    });
    res.send(zipBuffer);
  } catch (err) {
    console.error('❌ exportBackupZipApi error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function importBackupZipApi(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No .zip file uploaded.' });
    }

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(req.file.path);
    const zipEntries = zip.getEntries();

    const imgDir = path.join(PATHS.ASSETS_DIR, 'img');
    const voiceDir = path.join(PATHS.ASSETS_DIR, 'voice');
    fs.mkdirSync(imgDir, { recursive: true });
    fs.mkdirSync(voiceDir, { recursive: true });

    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      if (entry.entryName.startsWith('assets/img/')) {
        const fName = path.basename(entry.entryName);
        fs.writeFileSync(path.join(imgDir, fName), entry.getData());
      } else if (entry.entryName.startsWith('assets/voice/')) {
        const fName = path.basename(entry.entryName);
        fs.writeFileSync(path.join(voiceDir, fName), entry.getData());
      }
    }

    const configFile = zip.getEntry('wishmaster_config.json');
    if (configFile) {
      const configJson = JSON.parse(configFile.getData().toString('utf8'));
      const {
        saveBotFooter,
        saveWishExpiryDays,
        setBirthdaySongUrl,
        saveBirthdayMessageTemplate,
        saveDbSecretLetters,
        saveDbFrameStyles,
        saveContactPreference
      } = require('../services/db.service');
      const { saveFestiveTemplate, updateFestiveConfig } = require('../services/festive.service');
      const { saveTextLkConfig } = require('../services/sms.service');

      if (configJson.admin_settings) {
        if (configJson.admin_settings.bot_footer) await saveBotFooter(configJson.admin_settings.bot_footer);
        if (configJson.admin_settings.wish_expiry_days) await saveWishExpiryDays(configJson.admin_settings.wish_expiry_days);
        if (configJson.admin_settings.birthday_song_url) await setBirthdaySongUrl(configJson.admin_settings.birthday_song_url);
        if (configJson.admin_settings.birthday_message_template) await saveBirthdayMessageTemplate(configJson.admin_settings.birthday_message_template);
      }

      if (configJson.secret_letters) await saveDbSecretLetters(configJson.secret_letters);
      if (configJson.frame_styles) await saveDbFrameStyles(configJson.frame_styles);

      if (configJson.contact_preferences && typeof configJson.contact_preferences === 'object') {
        for (const [ph, pref] of Object.entries(configJson.contact_preferences)) {
          await saveContactPreference(pref);
        }
      }

      if (configJson.festive) {
        if (configJson.festive.config) {
          updateFestiveConfig(configJson.festive.config.caption, configJson.festive.config.image, configJson.festive.config.withImage);
        }
        if (Array.isArray(configJson.festive.templates)) {
          for (const t of configJson.festive.templates) {
            saveFestiveTemplate(t);
          }
        }
      }

      if (configJson.sms?.config) {
        await saveTextLkConfig(configJson.sms.config);
      }
    }

    try { fs.unlinkSync(req.file.path); } catch (e) {}

    console.log('✅ Full backup imported and all assets/configs restored successfully');
    res.json({
      success: true,
      message: 'Full backup imported successfully! Configurations, frames, and voice assets have been restored.'
    });
  } catch (err) {
    console.error('❌ importBackupZipApi error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

async function getFestiveCampaignsApi(req, res) {
  try {
    const { getFestiveCampaigns } = require('../services/db.service');
    const campaigns = await getFestiveCampaigns();
    res.json({ success: true, campaigns });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

async function broadcastFestiveCampaignApi(req, res) {
  try {
    const { title, caption, imagePath, channels } = req.body;
    const selectedChannels = Array.isArray(channels) && channels.length > 0 ? channels : ['whatsapp'];
    const campaignTitle = (title || 'Festive Broadcast').trim();
    const messageCaption = (caption || '🎉 Wishing you a wonderful festive season!').trim();

    const sock = getSocket();
    if (selectedChannels.includes('whatsapp') && !sock) {
      return res.status(503).json({ success: false, error: 'WhatsApp bot is not connected.' });
    }

    const { getAuthClient } = require('../config/google.config');
    const { listContactsFestive } = require('../services/google.service');
    const { saveFestiveCampaign, getSyncedContacts } = require('../services/db.service');
    const { sendSms, getTextLkConfig } = require('../services/sms.service');
    const { sendVoiceNote } = require('../services/voice.service');
    const { formatName, interpolateMessage } = require('../utils/text.util');
    const smsConfig = await getTextLkConfig();

    let people = [];
    try {
      const auth = await getAuthClient();
      if (auth) {
        people = await listContactsFestive(auth);
      }
    } catch (e) {}

    if (!Array.isArray(people) || people.length === 0) {
      people = await getSyncedContacts();
    }

    if (!Array.isArray(people) || people.length === 0) {
      return res.status(400).json({ success: false, error: 'No contacts found to broadcast to.' });
    }

    let imageBuffer = null;
    if (imagePath) {
      const fullImgPath = path.isAbsolute(imagePath) ? imagePath : path.join(PATHS.ROOT_DIR, imagePath.replace(/^\/+/, ''));
      if (fs.existsSync(fullImgPath)) {
        imageBuffer = fs.readFileSync(fullImgPath);
      }
    }

    const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const logs = [];
    let waSuccess = 0, waFailed = 0;
    let smsSuccess = 0, smsFailed = 0;
    let smsCreditsUsed = 0;

    console.log(`🚀 Starting Festive Campaign "${campaignTitle}" to ${people.length} contacts...`);

    for (const contact of people) {
      const phones = contact.phones || (contact.phone ? [contact.phone] : []);
      if (!phones || phones.length === 0) continue;

      const rawPhone = phones[0];
      const cleanPhone = String(rawPhone).replace(/\D/g, '');
      if (!cleanPhone) continue;

      const formattedName = formatName(contact.name) || 'Friend';
      const personalizedMsg = interpolateMessage(messageCaption, formattedName);

      const entryLog = {
        name: contact.name,
        phone: cleanPhone,
        whatsapp: 'skipped',
        sms: 'skipped',
        error: null,
        timestamp: new Date().toISOString()
      };

      // 1. WhatsApp Dispatch
      if (selectedChannels.includes('whatsapp') && sock) {
        const jid = `${cleanPhone}@s.whatsapp.net`;
        try {
          if (imageBuffer) {
            await sock.sendMessage(jid, { image: imageBuffer, caption: personalizedMsg });
          } else {
            await sock.sendMessage(jid, { text: personalizedMsg });
          }
          await sendVoiceNote(sock, jid, 'voice').catch(() => {});
          waSuccess++;
          entryLog.whatsapp = 'success';
          console.log(`✅ [Festive Campaign] WhatsApp sent to ${contact.name} (${cleanPhone})`);
        } catch (waErr) {
          waFailed++;
          entryLog.whatsapp = 'failed';
          entryLog.error = waErr.message;
        }
        await new Promise(r => setTimeout(r, 1200));
      }

      // 2. SMS Dispatch
      if (selectedChannels.includes('sms') && smsConfig.token) {
        try {
          const smsRes = await sendSms({
            phone: cleanPhone,
            message: personalizedMsg,
            recipientName: contact.name
          });
          if (smsRes.success) {
            smsSuccess++;
            smsCreditsUsed += (smsRes.creditsUsed || 1);
            entryLog.sms = 'success';
          } else {
            smsFailed++;
            entryLog.sms = 'failed';
            entryLog.error = (entryLog.error ? entryLog.error + '; ' : '') + (smsRes.message || 'SMS failed');
          }
        } catch (smsErr) {
          smsFailed++;
          entryLog.sms = 'failed';
        }
      }

      logs.push(entryLog);
    }

    const campaignRecord = await saveFestiveCampaign({
      campaign_id: campaignId,
      title: campaignTitle,
      caption: messageCaption,
      image_url: imagePath || null,
      channels: selectedChannels,
      total_contacts: logs.length,
      wa_success_count: waSuccess,
      wa_failed_count: waFailed,
      sms_success_count: smsSuccess,
      sms_failed_count: smsFailed,
      sms_credits_used: smsCreditsUsed,
      logs
    });

    res.json({
      success: true,
      campaign: campaignRecord,
      message: `Campaign "${campaignTitle}" complete! WhatsApp: ${waSuccess} sent, SMS: ${smsSuccess} sent (${smsCreditsUsed} credits used).`
    });
  } catch (err) {
    console.error('❌ broadcastFestiveCampaignApi error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  sendBirthdayManual,
  sendBirthdayForce,
  sendFestiveManual,
  updateFestive,
  getFestiveConfigApi,
  getFestiveTemplatesApi,
  saveFestiveTemplateApi,
  deleteFestiveTemplateApi,
  sendFestiveTestApi,
  getBirthdaysSentTodayStatus,
  clearBirthdaysSentTodayStatus,
  renderWishPage,
  getWishApi,
  openWishApi,
  completeWishApi,
  resetWishApi,
  getActiveWishesApi,
  getSongUrlApi,
  setSongUrlApi,
  uploadSongApi,
  getGeneralSettingsApi,
  saveGeneralSettingsApi,
  syncContactsApi,
  adminLoginApi,
  changeAdminPasswordApi,
  getSecretLettersApi,
  saveSecretLettersApi,
  importSecretLettersApi,
  deleteSecretLetterApi,
  getMessageTemplateApi,
  saveMessageTemplateApi,
  resetMessageTemplateApi,
  getContactPreferencesApi,
  getSingleContactPreferenceApi,
  saveContactPreferenceApi,
  getSmsConfigApi,
  saveSmsConfigApi,
  getSmsHistoryApi,
  sendCustomSmsApi,
  sendBirthdaySmsManualApi,
  sendWishWithOptionsApi,
  exportBackupZipApi,
  importBackupZipApi,
  getFestiveCampaignsApi,
  broadcastFestiveCampaignApi
};
