const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');

router.get('/contacts', contactController.getContacts);
router.get('/contacts_festive', contactController.getContactsFestive);
router.get('/api/tomorrow-contacts', contactController.getTomorrowContacts);

module.exports = router;

