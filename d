const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys")
const MAIN = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    browser: ['Baileys', 'Chrome', '10.0']
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode
      console.log('Connection closed. Reason:', reason)
      if (reason !== DisconnectReason.loggedOut) MAIN() // reconnect auto
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected!')
    }
  })
}
MAIN()
