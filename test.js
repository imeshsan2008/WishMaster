import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";

const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("whatsapp_auth");
  const sock = makeWASocket({ auth: state, printQRInTerminal: true });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("⚠️ Reconnecting...");
        startSock();
      } else {
        console.log("❌ Logged out. Please re-scan QR.");
      }
    } else if (connection === "open") {
      console.log("✅ WhatsApp bot connected!");
    }
  });

  sock.ev.on("creds.update", saveCreds);
};

startSock();
