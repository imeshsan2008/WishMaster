const path = require('path');
require('dotenv').config();

const ROOT_DIR = path.resolve(__dirname, '../../');
const FILES_DIR = path.join(ROOT_DIR, 'files');
const ASSETS_DIR = path.join(ROOT_DIR, 'assets');
const TEMPLATES_DIR = path.join(ROOT_DIR, 'templates');
const WA_AUTH_DIR = path.join(ROOT_DIR, 'whatsapp_auth');

const PORT = process.env.PORT || 8000;
const rawHostname = process.env.PROD_URL || process.env.prod_url || process.env.HOSTNAME2 || process.env.HOSTNAME || 'http://127.0.0.1:8000';
const HOSTNAME = rawHostname.trim().replace(/\/+$/, '');
const REDIRECT_URI = process.env.REDIRECT_URI || `${HOSTNAME}/oauth2callback`;
const BOT_VERSION = process.env.BOT_VERSION || 'V 4.0';

module.exports = {
  PORT,
  HOSTNAME,
  REDIRECT_URI,
  BOT_VERSION,
  ADMIN_GROUP_JID: '120363402125169216@g.us',

  // Google OAuth Scopes
  GOOGLE_SCOPES: [
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/userinfo.profile'
  ],

  // Paths
  PATHS: {
    ROOT_DIR,
    FILES_DIR,
    ASSETS_DIR,
    TEMPLATES_DIR,
    WA_AUTH_DIR,
    TOKEN: path.join(FILES_DIR, 'token.json'),
    CREDENTIALS: path.join(FILES_DIR, 'credentials.json'),
    CONTACTS_CACHE: path.join(FILES_DIR, 'Contacts.json'),
    FRAME_STYLES: path.join(FILES_DIR, 'frame_style_sheet.json'),
    MESSAGE_FILE: path.join(ROOT_DIR, 'custom_message.txt'),
    BIRTHDAY_LOG: path.join(ROOT_DIR, 'birthday_log.json'),
    FESTIVE_CONFIG: path.join(ROOT_DIR, 'festive_config.json'),
    FESTIVE_LOG: path.join(ROOT_DIR, 'festiveData.json'),
    FESTIVE_TEMPLATES: path.join(FILES_DIR, 'festive_templates.json'),
    SECRET_LETTERS: path.join(FILES_DIR, 'secret_letters.json')
  }
};

