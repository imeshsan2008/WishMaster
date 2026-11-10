const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/env.config');

/**
 * Sends an audio voice note (Push-to-Talk) to a WhatsApp contact.
 */
async function sendVoiceNote(sock, jid, voiceName = 'voice') {
  if (!sock) {
    console.warn('⚠️ WhatsApp socket not available to send voice note');
    return false;
  }

  const audioPath = path.join(PATHS.ASSETS_DIR, 'voice', `${voiceName}.ogg`);
  if (!fs.existsSync(audioPath)) {
    console.warn(`⚠️ Voice file not found at: ${audioPath}`);
    return false;
  }

  try {
    const audioBuffer = fs.readFileSync(audioPath);
    const sentVoice = await sock.sendMessage(jid, {
      audio: audioBuffer,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true
    });
    try {
      const { cacheSentProtoMessage } = require('./whatsapp.service');
      if (sentVoice?.key?.id && sentVoice?.message && cacheSentProtoMessage) {
        cacheSentProtoMessage(sentVoice.key.id, sentVoice.message);
      }
    } catch (e) {}
    console.log(`🎤 Voice message (${voiceName}) sent to ${jid}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send voice message to ${jid}:`, err.message || err);
    return false;
  }
}

module.exports = {
  sendVoiceNote
};

