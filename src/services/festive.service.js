const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/env.config');
const { safeReadJson, safeWriteJson } = require('../utils/file.util');
const { formatName, interpolateMessage } = require('../utils/text.util');
const { getAuthClient } = require('../config/google.config');
const { listContactsFestive } = require('./google.service');
const { sendVoiceNote } = require('./voice.service');
const { getLinkedNumber } = require('./whatsapp.service');

function getFestiveConfig() {
  return safeReadJson(PATHS.FESTIVE_CONFIG, {
    caption: '🎉 Happy Festival! Wishing you joy 💫',
    image: 'assets/img/festive_img.png',
    withImage: true
  });
}

function updateFestiveConfig(caption, relativeImagePath, withImage = true) {
  const config = getFestiveConfig();
  if (caption !== undefined && caption !== null) config.caption = caption;
  if (relativeImagePath) {
    config.image = relativeImagePath;
    config.withImage = true;
  } else if (withImage !== undefined) {
    config.withImage = Boolean(withImage);
  }
  return safeWriteJson(PATHS.FESTIVE_CONFIG, config);
}

function getFestiveTemplates() {
  return safeReadJson(PATHS.FESTIVE_TEMPLATES, []);
}

function saveFestiveTemplate({ id, title, caption, image, withImage = true }) {
  let templates = getFestiveTemplates();
  if (!Array.isArray(templates)) templates = [];

  const templateId = id || `tpl_${Date.now()}`;
  const existingIdx = templates.findIndex(t => t.id === templateId);

  const tplData = {
    id: templateId,
    title: title || 'Festive Greeting Template',
    caption: caption || '🎉 Happy Festive Greetings!',
    image: image || 'assets/img/festive_img.png',
    withImage: Boolean(withImage),
    updatedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    templates[existingIdx] = { ...templates[existingIdx], ...tplData };
  } else {
    templates.push(tplData);
  }

  safeWriteJson(PATHS.FESTIVE_TEMPLATES, templates);
  return tplData;
}

function deleteFestiveTemplate(templateId) {
  let templates = getFestiveTemplates();
  if (!Array.isArray(templates)) return false;
  templates = templates.filter(t => t.id !== templateId);
  return safeWriteJson(PATHS.FESTIVE_TEMPLATES, templates);
}

function getFestiveImageData() {
  const config = getFestiveConfig();
  if (config.withImage && config.image) {
    try {
      const fullPath = path.isAbsolute(config.image)
        ? config.image
        : path.join(PATHS.ROOT_DIR, config.image);

      if (fs.existsSync(fullPath)) {
        return {
          image: fs.readFileSync(fullPath),
          caption: config.caption || '🎉 Happy Festival!'
        };
      }
    } catch (err) {
      console.error('⚠️ Error reading festive image file:', err.message);
    }
  }

  return { caption: config.caption || '🎉 Happy Festival!' };
}

/**
 * Sends a single test festive message ONLY to the linked WhatsApp account (or specified number).
 */
async function sendFestiveTestMessage(sock, targetNumber = null, customCaption = null, customImagePath = null) {
  if (!sock) {
    throw new Error('WhatsApp socket not connected');
  }

  const linked = getLinkedNumber();
  const rawNumber = (targetNumber || linked || '').replace(/\D/g, '');
  if (!rawNumber) {
    throw new Error('No target number found. Please ensure WhatsApp is linked.');
  }

  const jid = `${rawNumber}@s.whatsapp.net`;
  const festiveConfig = getFestiveConfig();

  let message = customCaption || festiveConfig.caption || '🎉 Happy Festival! (Test Message)';
  message = interpolateMessage(message, 'Admin (Test)');

  const testHeader = `🧪 *[TEST FESTIVE BROADCAST]* 🧪\n_(This test message was sent only to your linked account)_\n\n`;
  const fullText = testHeader + message;

  let imageBuffer = null;
  const imgPath = customImagePath || festiveConfig.image;
  if (imgPath) {
    try {
      const fullPath = path.isAbsolute(imgPath) ? imgPath : path.join(PATHS.ROOT_DIR, imgPath);
      if (fs.existsSync(fullPath)) {
        imageBuffer = fs.readFileSync(fullPath);
      }
    } catch (e) {
      console.warn('⚠️ Could not read festive test image:', e.message);
    }
  }

  if (imageBuffer) {
    await sock.sendMessage(jid, {
      image: imageBuffer,
      caption: fullText
    });
  } else {
    await sock.sendMessage(jid, { text: fullText });
  }

  // Also send test voice note
  try {
    await sendVoiceNote(sock, jid, 'voice');
  } catch (e) {}

  console.log(`✅ Sent test festive message to linked number ${rawNumber}`);
  return { ok: true, recipient: rawNumber };
}

function logFestiveEvent(contactName, contactNumber, success) {
  let data = safeReadJson(PATHS.FESTIVE_LOG, {});
  if (!data || typeof data !== 'object') data = {};

  if (!Array.isArray(data.logs)) data.logs = [];
  if (typeof data.successCount !== 'number') data.successCount = 0;
  if (typeof data.errorCount !== 'number') data.errorCount = 0;

  data.logs.push({
    name: contactName,
    number: contactNumber,
    success,
    time: new Date().toISOString()
  });

  if (success) {
    data.successCount++;
  } else {
    data.errorCount++;
  }

  safeWriteJson(PATHS.FESTIVE_LOG, data);
}

function getFestiveLogs() {
  return safeReadJson(PATHS.FESTIVE_LOG, { logs: [], successCount: 0, errorCount: 0 });
}

/**
 * Broadcasts festive greetings to all contacts with controlled rate-limiting.
 */
async function sendFestiveBroadcast(sock, senderId = null) {
  if (!sock) {
    console.error('❌ Cannot send festive messages: WhatsApp socket not connected');
    return;
  }

  try {
    const auth = await getAuthClient();
    if (!auth) {
      console.error('❌ Google Auth client not available for festive broadcast');
      return;
    }

    const people = await listContactsFestive(auth);
    if (!Array.isArray(people) || people.length === 0) {
      console.log('⚠️ No festive contacts found.');
      return;
    }

    console.log(`📢 Starting festive broadcast to ${people.length} contacts...`);
    const festiveData = getFestiveImageData();

    for (const contact of people) {
      if (!contact || !Array.isArray(contact.phones) || contact.phones.length === 0) {
        continue;
      }

      const formatted = formatName(contact.name) || 'there';
      const phone = contact.phones[0].replace(/\D/g, '');
      const jid = `${phone}@s.whatsapp.net`;

      let message = festiveData.caption || '🎉 Happy Festival!';
      message = interpolateMessage(message, formatted);

      let attempts = 0;
      const maxRetries = 2;
      const delay = 2500; // Safe interval between messages

      while (attempts < maxRetries) {
        try {
          if (festiveData.image) {
            await sock.sendMessage(jid, {
              image: festiveData.image,
              caption: message
            });
          } else {
            await sock.sendMessage(jid, { text: message });
          }

          // Voice greeting logic: exclude teachers / elders if desired
          const lowerName = formatted.toLowerCase();
          const isHonoredTitle = ['teacher', 'sir', 'miss', 'madam'].some(t => lowerName.includes(t));
          if (!isHonoredTitle) {
            await sendVoiceNote(sock, jid, 'voice');
          }

          logFestiveEvent(formatted, contact.phones[0], true);

          if (senderId) {
            await sock.sendMessage(senderId, {
              text: `✅ Sent festive message to ${formatted} (${contact.phones[0]})`
            }).catch(() => {});
          }

          console.log(`✅ Sent festive message to ${formatted} (${contact.phones[0]})`);
          break;
        } catch (err) {
          attempts++;
          console.error(`❌ Failed festive message to ${formatted} (${attempts}/${maxRetries}):`, err.message || err);
          if (attempts < maxRetries) {
            await new Promise(res => setTimeout(res, delay));
          } else {
            logFestiveEvent(formatted, contact.phones[0], false);
          }
        }
      }

      // Throttle between different contacts to prevent account ban
      await new Promise(res => setTimeout(res, 1500));
    }

    console.log('🎉 Festive broadcast completed successfully!');
  } catch (err) {
    console.error('❌ Error during festive broadcast:', err.message || err);
  }
}

module.exports = {
  getFestiveConfig,
  updateFestiveConfig,
  getFestiveTemplates,
  saveFestiveTemplate,
  deleteFestiveTemplate,
  sendFestiveTestMessage,
  getFestiveImageData,
  logFestiveEvent,
  getFestiveLogs,
  sendFestiveBroadcast
};

