const fs = require('fs');
const path = require('path');

/**
 * Safely reads a JSON file. Returns defaultValue if missing or parse fails.
 */
function safeReadJson(filePath, defaultValue = null) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`⚠️ safeReadJson error (${filePath}):`, err.message);
    return defaultValue;
  }
}

/**
 * Safely writes data to a JSON file, creating parent directories if needed.
 */
function safeWriteJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`⚠️ safeWriteJson error (${filePath}):`, err.message);
    return false;
  }
}

module.exports = {
  safeReadJson,
  safeWriteJson
};

