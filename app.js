/**
 * WishMaster - Root Application Entry Point
 * Production-ready modular structure located in ./src/
 */

require('dotenv').config();
const { startServer } = require('./src/server');

startServer().catch(err => {
  console.error('Fatal application error:', err);
  process.exit(1);
});
