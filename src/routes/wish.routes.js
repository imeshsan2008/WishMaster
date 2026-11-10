const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const wishController = require('../controllers/wish.controller');
const { PATHS } = require('../config/env.config');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(PATHS.ASSETS_DIR, 'img'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `festive_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(PATHS.ASSETS_DIR, 'voice');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp3';
    cb(null, `song_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
  }
});
const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: 30 * 1024 * 1024 }
});

const zipStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(PATHS.FILES_DIR, 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `backup_${Date.now()}.zip`);
  }
});
const uploadZip = multer({
  storage: zipStorage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

// Birthday & Festive Manual Triggers
router.get('/sendbirthday', wishController.sendBirthdayManual);
router.get('/sendfestive', wishController.sendFestiveManual);
router.get('/api/send/:senderId/:contactName', wishController.sendBirthdayForce);
router.get('/api/festive/config', wishController.getFestiveConfigApi);
router.get('/api/festive/templates', wishController.getFestiveTemplatesApi);
router.post('/api/festive/templates', wishController.saveFestiveTemplateApi);
router.delete('/api/festive/templates/:id', wishController.deleteFestiveTemplateApi);
router.post('/api/festive/test-send', wishController.sendFestiveTestApi);
router.post('/api/festive/update', upload.single('image'), wishController.updateFestive);
router.get('/birthdaysSentToday', wishController.getBirthdaysSentTodayStatus);
router.get('/birthdaysclear', wishController.clearBirthdaysSentTodayStatus);

// Web Page Based Birthday Wish Endpoints
router.get('/wish/:code', wishController.renderWishPage);
router.get('/api/wish/:code', wishController.getWishApi);
router.post('/api/wish/:code/open', wishController.openWishApi);
router.post('/api/wish/:code/complete', wishController.completeWishApi);
router.post('/api/wish/:code/reset', wishController.resetWishApi);
router.get('/api/active-wishes', wishController.getActiveWishesApi);

// Admin & Settings Endpoints
router.get('/api/settings/song', wishController.getSongUrlApi);
router.post('/api/settings/song', wishController.setSongUrlApi);
router.post('/api/settings/upload-song', uploadAudio.single('songFile'), wishController.uploadSongApi);
router.get('/api/settings/general', wishController.getGeneralSettingsApi);
router.post('/api/settings/general', wishController.saveGeneralSettingsApi);
router.post('/api/contacts/sync', wishController.syncContactsApi);
router.post('/api/admin/login', wishController.adminLoginApi);
router.post('/api/admin/change-password', wishController.changeAdminPasswordApi);

// Secret Birthday Letters Endpoints
router.get('/api/secret-letters', wishController.getSecretLettersApi);
router.post('/api/secret-letters', wishController.saveSecretLettersApi);
router.post('/api/secret-letters/import', wishController.importSecretLettersApi);
router.delete('/api/secret-letters/:id', wishController.deleteSecretLetterApi);

// Birthday Message Template Endpoints
router.get('/api/message-template', wishController.getMessageTemplateApi);
router.post('/api/message-template', wishController.saveMessageTemplateApi);
router.post('/api/message-template/reset', wishController.resetMessageTemplateApi);

// Contact Personalization Preferences (Letter & Frame assignment per contact)
router.get('/api/contact-preferences', wishController.getContactPreferencesApi);
router.get('/api/contact-preferences/:phone', wishController.getSingleContactPreferenceApi);
router.post('/api/contact-preferences', wishController.saveContactPreferenceApi);

// Text.lk SMS Gateway Endpoints
router.get('/api/sms/config', wishController.getSmsConfigApi);
router.post('/api/sms/config', wishController.saveSmsConfigApi);
router.get('/api/sms/history', wishController.getSmsHistoryApi);
router.post('/api/sms/send', wishController.sendCustomSmsApi);
router.post('/api/sms/send-birthday/:phone', wishController.sendBirthdaySmsManualApi);

// Advanced Multi-Channel & Multi-Number Send Endpoint
router.post('/api/send-wish', wishController.sendWishWithOptionsApi);

// System Backup & Restore (.ZIP Archive)
router.get('/api/backup/export', wishController.exportBackupZipApi);
router.post('/api/backup/import', uploadZip.single('backupZip'), wishController.importBackupZipApi);

// Festive Campaigns Endpoints
router.get('/api/festive/campaigns', wishController.getFestiveCampaignsApi);
router.post('/api/festive/campaigns/broadcast', wishController.broadcastFestiveCampaignApi);

module.exports = router;
