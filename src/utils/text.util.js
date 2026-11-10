const fs = require('fs');
const { PATHS } = require('../config/env.config');

/**
 * Formats a contact name (handles titles like Sir, Miss, Teacher, Madam).
 */
function formatName(name) {
  if (!name) return '';

  const lower = name.toLowerCase().trim();
  if (lower.includes('miss')) return 'Miss';
  if (lower.includes('sir')) return 'Sir';
  if (lower.includes('teacher')) return 'Teacher';
  if (lower.includes('madam')) return 'Madam';

  return name
    .trim()
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Retrieves the custom birthday message template from file or fallback.
 */
function getCustomMessage() {
  try {
    if (fs.existsSync(PATHS.MESSAGE_FILE)) {
      return fs.readFileSync(PATHS.MESSAGE_FILE, 'utf8').trim();
    }
  } catch (err) {
    console.error('⚠️ getCustomMessage error:', err.message);
  }
  return '🎉 Happy Birthday, ${name}! 🎂 Wishing you a fantastic year ahead!';
}

/**
 * Replaces ${name} placeholders in message template.
 */
function interpolateMessage(template, name) {
  const safeName = name || 'there';
  return (template || '').replace(/\$\{name\}/g, safeName);
}

module.exports = {
  formatName,
  getCustomMessage,
  interpolateMessage
};

