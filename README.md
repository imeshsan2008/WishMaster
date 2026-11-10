# 🎂 WishMaster (v4.0)

Automated WhatsApp bot and web dashboard for greeting contacts on their birthdays and festive seasons. Integrates Google Contacts with WhatsApp (via Baileys) to dynamically generate framed photo cards and send personalized audio voice notes.

---

## 🌟 Key Features

* **Google Contacts Integration**: Automatically fetches contacts, birthdays, and profile pictures via Google People API.
* **WhatsApp Automation**: Uses `@whiskeysockets/baileys` with Multi-File Auth and QR/Pairing code support.
* **Dynamic Card Generator**: Composites profile pictures inside custom styled greeting frames with typography using `sharp`.
* **Push-to-Talk (PTT) Audio**: Automatically sends voice greeting notes alongside cards.
* **Automated Cron Scheduling**: Daily flag reset at 23:00 and automated morning birthday dispatch at 08:00 AM (Asia/Colombo).
* **Festive Broadcasting Mode**: Dedicated dashboard to broadcast custom seasonal greetings with anti-ban rate limiting.
* **Interactive WhatsApp Commands**: `.alive`, `.send`, `.help`, `.dev`, and automated emoji reactions.

---

## 🏗️ Architecture & Project Structure

```
wishmy/
├── src/
│   ├── config/
│   │   ├── env.config.js          # App configurations, paths, constants
│   │   └── google.config.js       # Google OAuth2 and People API auth clients
│   ├── utils/
│   │   ├── file.util.js           # Safe JSON file read/write helpers
│   │   └── text.util.js           # Name formatting & template replacer
│   ├── services/
│   │   ├── whatsapp.service.js    # Baileys client lifecycle, commands & reactions
│   │   ├── google.service.js      # Google People API: Contacts, birthdays, photos
│   │   ├── image.service.js       # Sharp image engine, frame compositor & fonts
│   │   ├── voice.service.js       # Push-to-Talk audio note sender
│   │   ├── birthday.service.js    # Birthday greeting pipeline, retries & logging
│   │   └── festive.service.js     # Festive greetings broadcaster & anti-ban throttle
│   ├── controllers/
│   │   ├── auth.controller.js     # OAuth callback, Google & WhatsApp session logout
│   │   ├── contact.controller.js  # /contacts, /contacts_festive, /api/tomorrow-contacts
│   │   ├── style.controller.js    # Frame styles configuration
│   │   ├── wish.controller.js     # Manual triggers (/sendbirthday, /sendfestive, etc.)
│   │   └── status.controller.js   # QR images, status checks, logs, test messages
│   ├── routes/
│   │   ├── auth.routes.js         # Authentication endpoints
│   │   ├── contact.routes.js      # Contact endpoints
│   │   ├── style.routes.js        # Style endpoints
│   │   ├── wish.routes.js         # Birthday & Festive trigger endpoints
│   │   ├── status.routes.js       # Status & log endpoints
│   │   └── index.js               # Route aggregator & HTML views
│   ├── jobs/
│   │   └── cron.jobs.js           # Scheduled tasks (midnight reset, morning check)
│   ├── app.js                     # Express app setup, middlewares, static asset mounts
│   └── server.js                  # HTTP Server, Socket.IO, Bot launcher, shutdown
├── app.js                         # Root entry point (delegates to src/server.js)
├── app.legacy.js                  # Original monolithic single-file backup
├── files/                         # Configuration, frame styles, cache & tokens
├── assets/                        # Frames, fonts, images & voice notes
└── templates/                     # Dashboard & festive UI templates
```

---

## 🚀 Getting Started

### 1. Installation
```bash
npm install
```

### 2. Configuration
Copy `.env.example` to `.env` and configure your hostname:
```env
PORT=8000
HOSTNAME2=http://127.0.0.1:8000
REDIRECT_URI=http://127.0.0.1:8000/oauth2callback
BOT_VERSION="V 4.0"
```

Ensure your Google OAuth `credentials.json` is located in `files/credentials.json`.

### 3. Run the Server
* **Development / Production**:
  ```bash
  npm start
  ```
* **With PM2**:
  ```bash
  npm run dev
  ```

---

## 📱 Bot Commands (in WhatsApp)

| Command | Description |
| :--- | :--- |
| `.alive` | Displays bot status and uptime |
| `.send` | Manually checks and triggers today's birthday wishes |
| `.help` / `.menu` | Displays the bot commands guide |
| `.dev` | Displays developer contact info |

---

## 🛡️ License
ISC

