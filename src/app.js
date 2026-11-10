const path = require('path');
const express = require('express');
const { PATHS } = require('./config/env.config');
const routes = require('./routes');

const app = express();

// Standard middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static directories
app.use('/assets', express.static(PATHS.ASSETS_DIR));
app.use('/assets/img', express.static(path.join(PATHS.ASSETS_DIR, 'img')));

// Application routes
app.use(routes);

// Global error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled Server Error:', err);
  res.status(500).json({
    ok: false,
    error: 'Internal Server Error',
    message: err.message
  });
});

module.exports = app;

