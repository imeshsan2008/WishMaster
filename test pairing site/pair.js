import express from "express";
import {
  default as makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import qrcode from "qrcode";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

let qrString = null;
let pairingCode = null;
let sock = null;
let linkedJid = null;
let currentMode = "qr"; // 'qr' or 'code'

// Serve UI
app.use(express.static(path.join(__dirname, "public")));

app.get("/qr", async (req, res) => {
  if (currentMode !== "qr") return res.status(400).send("QR mode disabled");
  if (!qrString) return res.status(400).send("QR not ready");
  qrcode.toDataURL(qrString, (err, url) => {
    if (err) return res.status(500).send(err);
    res.json({ qr: url });
  });
});

app.get("/pairing-code", (req, res) => {
  if (currentMode !== "code") return res.status(400).send("Pairing code mode disabled");
  if (!pairingCode) return res.status(400).send("Code not ready");
  res.json({ code: pairingCode });
});

app.get("/status", (req, res) => {
  res.json({ connected: !!linkedJid, linkedJid, mode: currentMode });
});

app.post("/switch-mode", express.json(), async (req, res) => {
  const { mode } = req.body;
  if (!["qr", "code"].includes(mode)) return res.status(400).send("Invalid mode");
  currentMode = mode;
  qrString = null;
  pairingCode = null;
  startSock();
  res.json({ mode });
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
    browser: ["WishMaster", "Chrome", "1.0.0"],
    generateHighQualityLinkPreview: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (currentMode === "qr" && qr) {
      qrString = qr;
      console.log("📱 QR generated. Scan it in WhatsApp Linked Devices.");
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ Connection closed:", reason);
      setTimeout(startSock, 5000);
    } else if (connection === "open") {
      linkedJid = sock.user.id;
      console.log("✅ Connected as:", linkedJid);
      qrString = null;
      pairingCode = null;
      sock.sendMessage(linkedJid, {
        text: `🎉 WishMaster connected successfully to ${linkedJid}`
      });
    }
  });

  // Generate pairing code if mode = code
  if (currentMode === "code") {
    setTimeout(async () => {
      const code = await sock.requestPairingCode("94XXXXXXXXX"); // put your number with country code
      pairingCode = code;
      console.log("🔢 Pairing code:", code);
    }, 2000);
  }
}

startSock();

app.listen(PORT, () => {
  console.log(`🚀 WishMaster running at http://localhost:${PORT}`);
});
