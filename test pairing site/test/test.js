const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const path = require('path');
const QRCode = require('qrcode');

const WA_AUTH_DIR = path.join(__dirname, 'whatsapp_auth');

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);

    const sock = makeWASocket({ auth: state,  markOnlineOnConnect: false, printQRInTerminal: false, syncFullHistory: false });
    sockInstance = sock; // set global reference for routes

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, qr, lastDisconnect, isNewLogin } = update;

      if (qr) {
        const qrData = await QRCode.toDataURL(qr);
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp connected!');
        birthdaysSentToday = false; // reset daily flag on reconnect
      }

      if (connection === 'close') {
        console.log('⚠️ WhatsApp disconnected!');
        // Attempt reconnect after a short delay
        setTimeout(() => startBot().catch(e => console.error('Failed to restart bot:', e.message)), 3000);
      }
    });

    // messages listener
    sock.ev.on('messages.upsert', async (msgData) => {
      try {
        const message = msgData.messages?.[0];
        if (!message) return;
        const sender = message?.key?.remoteJid;
        if (!message?.message || !sender || sender.includes('g.us') || sender.includes('status@broadcast')) return;

        // Extract text safely
        const text = message.message.conversation || message.message.extendedTextMessage?.text || message.message.imageMessage?.caption || message.message.videoMessage?.caption || message.message.buttonsResponseMessage?.selectedButtonId || message.message.listResponseMessage?.singleSelectReply?.selectedRowId || "";
        if (!text) return;
        const command = text.trim().toLowerCase();

        console.log(`👉 From: ${sender} | Text: ${command}`);

        // uptime
        const uptimeMs = Date.now() - (global.startTime || Date.now());
        const hours = Math.floor(uptimeMs / 3600000);
        const minutes = Math.floor((uptimeMs % 3600000) / 60000);
        const seconds = Math.floor((uptimeMs % 60000) / 1000);

        // helper reaction
        async function addReactionLocal(messageKey, reactionEmoji) {
          try { if (messageKey) await sock.sendMessage(messageKey.remoteJid, { react: { text: reactionEmoji, key: messageKey } }); } catch (err) { /* ignore */ }
        }

        switch (true) {
          case command === '.alive':
            await sock.sendMessage(sender, { text: `✅ Bot is Active!\n\n⏱ Uptime: ${hours}h ${minutes}m ${seconds}s\n\n> WishMaster v1.0` });
            await addReactionLocal(message.key, '👽');
            break;

          case command === '.send':
            await sock.sendMessage(sender, { text: `⏳ Checking for today's birthdays...   > Wish Master V1.0 | Command` });
            await sendTodaysBirthdays(sock, sender);
            await sock.sendMessage(sender, { text: `✅ Birthday check completed. > Wish Master V1.0 | Command` });
            await addReactionLocal(message.key, '✅');
            break;

          case command === '.help' || command === '.menu':
            await sock.sendMessage(sender, { text: `📖 *WishMaster Bot Commands:*\n\n.alive - Check bot status\n.send - Run birthday check now\n.dev - Get Developer contact\n\n*This bot is only for one task: to send birthday wishes to a person.*\n\n> WishMaster v1.0` });
            await addReactionLocal(message.key, '📃');
            break;

          case command === '.dev':
            await sock.sendMessage(sender, { text: `👨‍💻 Developer:\nName: Imesh Sandeepa (Dark Venom)\nWhatsApp: +94768902513\nEmail: imeshsan2008@gmail.com\nWebsite: https://imeshsan2008.github.io/\n> WishMaster v1.0` });
            await addReactionLocal(message.key, '👨‍💻');
            break;

          default:
            // simple thanks reaction
            if (/thank(s| you)/i.test(command)) await addReactionLocal(message.key, '❤️');
            break;
        }
      } catch (err) {
        console.error('⚠️ Message processing error:', err.message || err);
      }
    });

    global.startTime = Date.now();
    return sock;
  } catch (err) {
    console.error('❌ startBot error:', err.message || err);
    throw err;
  }
}


startBot();
