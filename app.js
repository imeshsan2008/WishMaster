/**
 * WishMaster - Root Application Entry Point
 * Production-ready modular structure located in ./src/
 */

require('dotenv').config();
const serverModule = require('./src/server');

const start = typeof serverModule.startServer === 'function' 
  ? serverModule.startServer 
  : (typeof serverModule === 'function' ? serverModule : null);

if (start) {
  start().catch(err => {
    console.error('Fatal application error:', err);
    process.exit(1);
  });
}
