const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');

router.get('/oauth2callback', authController.googleCallback);
router.post('/api/logout/google', authController.googleLogout);
router.post('/api/logout/whatsapp', authController.whatsappLogout);

module.exports = router;

