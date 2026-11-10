const express = require('express');
const multer = require('multer');
const router = express.Router();
const statusController = require('../controllers/status.controller');

const uploadSession = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

router.get('/api/status', statusController.getSystemStatus);
router.get('/ping', statusController.pingHandler);
router.get('/health', statusController.pingHandler);
router.get('/api/cron/trigger', statusController.cronTriggerHandler);
router.get('/qr-img', statusController.getQrImage);
router.get('/status', statusController.getPairingStatus);
router.get('/send-test', statusController.sendTestMessage);
router.get('/api/birthday-logs', statusController.getBirthdayLogsHandler);
router.get('/api/festive-logs', statusController.getFestiveLogsHandler);
router.get('/api/session/export-whatsapp', statusController.exportWhatsAppSession);
router.post('/api/session/import-whatsapp', uploadSession.single('sessionFile'), statusController.importWhatsAppSession);
router.get('/api/session/export-creds', statusController.exportWhatsAppCreds);
router.get('/clear_list', statusController.clearRetriesHandler);
router.get('/api/qr', (req, res) => {
  res.json({ message: 'QR served via /qr-img or socket.io' });
});

module.exports = router;

