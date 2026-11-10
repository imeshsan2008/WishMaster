const path = require('path');
const express = require('express');
const router = express.Router();
const { PATHS } = require('../config/env.config');

const authRoutes = require('./auth.routes');
const contactRoutes = require('./contact.routes');
const styleRoutes = require('./style.routes');
const wishRoutes = require('./wish.routes');
const statusRoutes = require('./status.routes');

// Mount API and feature sub-routes
router.use(authRoutes);
router.use(contactRoutes);
router.use(styleRoutes);
router.use(wishRoutes);
router.use(statusRoutes);

// View routes
router.get('/', (req, res) => {
  res.sendFile(path.join(PATHS.TEMPLATES_DIR, 'index.html'));
});

router.get('/home', (req, res) => {
  res.sendFile(path.join(PATHS.TEMPLATES_DIR, 'index.html'));
});

router.get('/festive', (req, res) => {
  res.sendFile(path.join(PATHS.TEMPLATES_DIR, 'index_festive.html'));
});

module.exports = router;

