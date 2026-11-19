const fs = require('fs');
const path = require('path');
const { PATHS } = require('../config/env.config');

function getMimeTypeForExt(extOrUrl) {
  const clean = String(extOrUrl || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.mp3')) return 'audio/mpeg';
  if (clean.endsWith('.wav')) return 'audio/wav';
  if (clean.endsWith('.m4a') || clean.endsWith('.mp4')) return 'audio/mp4';
  return 'audio/ogg; codecs=opus';
}

/**
 * Resolves the audio buffer and mimetype from the configured Custom Audio URL / Uploaded Song,
 * falling back to assets/voice/{voiceName}.ogg if unavailable.
 */
async function resolveVoiceAudioPayload(voiceName = 'voice') {
  try {
    const { getBirthdaySongUrl } = require('./db.service');
    const customSongUrl = await getBirthdaySongUrl();

    if (customSongUrl) {
      // 1. Local file path (/assets/voice/...)
      if (customSongUrl.startsWith('/assets/') || customSongUrl.startsWith('assets/')) {
        const relPath = customSongUrl.replace(/^\/+/, '');
        const fullPath = path.join(PATHS.ROOT_DIR, relPath);
        if (fs.existsSync(fullPath)) {
          return {
            buffer: fs.readFileSync(fullPath),
            mimetype: getMimeTypeForExt(fullPath),
            source: customSongUrl
          };
        }
      } else if (/^https?:\/\//i.test(customSongUrl)) {
        // 2. Remote Custom Audio URL (https://...)
        const res = await fetch(customSongUrl);
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          const contentType = res.headers.get('content-type') || getMimeTypeForExt(customSongUrl);
          return {
            buffer: Buffer.from(arrayBuf),
            mimetype: contentType.includes('audio/') ? contentType : getMimeTypeForExt(customSongUrl),
            source: customSongUrl
          };
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ Could not resolve custom audio URL for voice note, falling back to default:', err.message);
  }

  // 3. Fallback to default assets/voice/{voiceName}.ogg
  const audioPath = path.join(PATHS.ASSETS_DIR, 'voice', `${voiceName}.ogg`);
  if (fs.existsSync(audioPath)) {
    return {
      buffer: fs.readFileSync(audioPath),
      mimetype: 'audio/ogg; codecs=opus',
      source: `${voiceName}.ogg`
    };
  }

  return null;
}

/**
 * Sends an audio voice note (Push-to-Talk) to a WhatsApp contact.
 */
async function sendVoiceNote(sock, jid, voiceName = 'voice') {
  if (!sock) {
    console.warn('⚠️ WhatsApp socket not available to send voice note');
    return false;
  }

  const payload = await resolveVoiceAudioPayload(voiceName);
  if (!payload || !payload.buffer) {
    console.warn(`⚠️ No voice/audio file available to send to ${jid}`);
    return false;
  }

  try {
    const sentVoice = await sock.sendMessage(jid, {
      audio: payload.buffer,
      mimetype: payload.mimetype,
      ptt: true
    });
    try {
      const { cacheSentProtoMessage } = require('./whatsapp.service');
      if (sentVoice?.key?.id && sentVoice?.message && cacheSentProtoMessage) {
        cacheSentProtoMessage(sentVoice.key.id, sentVoice.message);
      }
    } catch (e) {}
    console.log(`🎤 Voice/Audio message (${payload.source}) sent to ${jid}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send voice message to ${jid}:`, err.message || err);
    return false;
  }
}

module.exports = {
  sendVoiceNote
};

