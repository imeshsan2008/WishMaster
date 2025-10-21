// wishmaster.js
// WhatsApp Bot using the latest Baileys (v7+) + Express
// Compatible with Node.js v18+ / v20+ / v24+
// Author: Imesh Sandeepa

import express from "express";
import qrcode from "qrcode";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from "@whiskeysockets/baileys";

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Config ---
const PORT = process.env.PORT || 3000;
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || null; // e.g. "947XXXXXXXX@s.whatsapp.net"
const SESSION_FOLDER = path.resolve(__dirname, "./whatsapp_auth");

const app = express();
let latestQR = null;
let pairingStatus = "idle";
let linkedNumber = null;
let sockInstance = null;

// --- Start WhatsApp Socket ---
async function startSocket() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ["WishMaster", "Chrome", "1.0"]

    });

    sockInstance = sock;

    // Save credentials
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQR = qr;
        pairingStatus = "qr-received";
        console.log("📱 Scan the QR to link WhatsApp");
      }

      if (connection === "open") {
        pairingStatus = "paired";
        linkedNumber = sock.user?.id || null;
        console.log("✅ WhatsApp connected as:", linkedNumber);

        if (ADMIN_NUMBER) {
          try {
            await sock.sendMessage(ADMIN_NUMBER, {
              text: `🤖 WishMaster Bot linked successfully!\nLinked: ${linkedNumber}`,
            });
          } catch (err) {
            console.warn("Failed to send admin message:", err.message);
          }
        }
      }

      if (connection === "close") {
        const reason =
          lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error;
        console.log("⚠️ Connection closed:", reason);
        pairingStatus = "closed";
        setTimeout(() => startSocket(), 3000);
      }
    });

    sock.ev.on("messages.upsert", async (m) => {
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const from = msg.key.remoteJid;
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      if (text.toLowerCase() === "hi") {
        await sock.sendMessage(from, {
          text: "👋 Hello! I’m WishMaster — your WhatsApp assistant.",
        });
      }
    });
  } catch (err) {
    console.error("❌ startSocket error:", err);
    setTimeout(startSocket, 3000);
  }
}

startSocket();

// --- Mini Web UI ---
app.get("/", async (req, res) => {
  const html = `
  <html>
    <head>
      <title>WishMaster Bot</title>
      <style>
        body { font-family: sans-serif; text-align: center; background: #0b0c10; color: #c5c6c7; }
        .card { background: #1f2833; padding: 30px; border-radius: 16px; display: inline-block; margin-top: 60px; box-shadow: 0 0 15px #45a29e; }
        img { margin-top: 20px; border-radius: 12px; }
        h1 { color: #66fcf1; }
        button { background:#45a29e; color:white; border:none; border-radius:8px; padding:10px 18px; margin-top:15px; cursor:pointer; }
        button:hover { background:#66fcf1; color:black; }
      </style>
      <script>
        async function refresh() {
          const qrImg = document.getElementById('qr');
          const res = await fetch('/status');
          const data = await res.json();
          document.getElementById('status').innerText = data.status;
          if (data.status === 'qr-received') {
            const qrRes = await fetch('/qr-img');
            const blob = await qrRes.blob();
            qrImg.src = URL.createObjectURL(blob);
            qrImg.style.display = 'block';
          } else if (data.status === 'paired') {
            qrImg.style.display = 'none';
            document.getElementById('linknum').innerText = data.linked || 'Unknown';
          }
        }
        async function sendTest() {
          const res = await fetch('/send-test');
          const data = await res.json();
          alert(data.message);
        }
        setInterval(refresh, 2000);
      </script>
    </head>
    <body onload="refresh()">
      <div class="card">
        <h1>🤖 WishMaster WhatsApp Bot</h1>
        <p>Status: <span id="status">loading...</span></p>
        <p>Linked: <span id="linknum">none</span></p>
        <img id="qr" src="" width="300" alt="QR Code will appear here" />
        <br>
        <button onclick="sendTest()">Send Test Message</button>
      </div>
    </body>
  </html>`;
  res.send(html);
});

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


app.listen(PORT, () =>
  console.log(`🚀 WishMaster running → http://localhost:${PORT}`)
);
