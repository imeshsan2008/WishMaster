const fs = require('fs');
const { google } = require('googleapis');
const { PATHS } = require('../config/env.config');
const { safeReadJson, safeWriteJson } = require('../utils/file.util');

let lastSyncSignature = '';

/**
 * Fetches contacts with birthdays directly from Google People API in real-time.
 * If offline or rate-limited, safely falls back to local cache.
 */
async function listContacts(auth, forceFresh = false) {
  // If not forcing fresh and fresh cache exists within last 30 seconds, reuse to prevent API throttling
  if (!forceFresh && fs.existsSync(PATHS.CONTACTS_CACHE)) {
    try {
      const stats = fs.statSync(PATHS.CONTACTS_CACHE);
      const isVeryRecent = (Date.now() - stats.mtimeMs) < 30 * 1000; // 30 seconds debounce
      if (isVeryRecent) {
        const cached = safeReadJson(PATHS.CONTACTS_CACHE, null);
        if (cached && cached.length > 0) return cached;
      }
    } catch (e) {}
  }

  // Fetch live from Google People API
  try {
    const service = google.people({ version: 'v1', auth });
    const res = await service.people.connections.list({
      resourceName: 'people/me',
      pageSize: 2000,
      personFields: 'names,emailAddresses,phoneNumbers,birthdays,photos'
    });

    const connections = res.data.connections || [];
    console.log(`✅ Live Google Contacts fetched (${connections.length} total connections)`);

    const contacts = connections
      .filter(p => p.birthdays && p.birthdays.length > 0)
      .map(p => ({
        name: p.names ? p.names[0].displayName : '',
        emails: p.emailAddresses ? p.emailAddresses.map(e => e.value) : [],
        phones: p.phoneNumbers ? p.phoneNumbers.map(ph => ph.value) : [],
        birthday: p.birthdays ? p.birthdays[0].date : null,
        photo: p.photos && p.photos.length > 0 ? p.photos[0].url : null
      }));

    safeWriteJson(PATHS.CONTACTS_CACHE, contacts);
    return contacts;
  } catch (err) {
    console.warn('⚠️ Google API request failed, serving local contacts cache:', err.message);
    return safeReadJson(PATHS.CONTACTS_CACHE, []);
  }
}

/**
 * Fetches all contacts for festive announcements in real-time.
 */
async function listContactsFestive(auth) {
  try {
    const service = google.people({ version: 'v1', auth });
    const res = await service.people.connections.list({
      resourceName: 'people/me',
      pageSize: 2000,
      personFields: 'names,emailAddresses,phoneNumbers,birthdays,photos'
    });

    return (res.data.connections || []).map(p => ({
      name: p.names ? p.names[0].displayName : '',
      phones: p.phoneNumbers ? p.phoneNumbers.map(ph => ph.value) : [],
      photo: p.photos && p.photos.length > 0 ? p.photos[0].url : null
    }));
  } catch (err) {
    console.warn('⚠️ listContactsFestive error, falling back to cache:', err.message);
    return safeReadJson(PATHS.CONTACTS_CACHE, []);
  }
}

/**
 * Helper to get current Date parts in Asia/Colombo timezone.
 */
function getColomboDateParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  }).formatToParts(new Date());
  const year = parseInt(parts.find(p => p.type === 'year').value, 10);
  const month = parseInt(parts.find(p => p.type === 'month').value, 10);
  const day = parseInt(parts.find(p => p.type === 'day').value, 10);
  return { year, month, day };
}

/**
 * Gets contacts whose birthday matches today's month and day in real-time.
 * Strictly uses Asia/Colombo timezone to guarantee accuracy on international cloud hosts.
 */
async function getTodayBirthdays(auth) {
  const contacts = await listContacts(auth, true);
  const { month, day } = getColomboDateParts();

  return (contacts || [])
    .filter(c => c.birthday && Number(c.birthday.month) === month && Number(c.birthday.day) === day)
    .map(c => {
      const validPhones = (c.phones || [])
        .map(p => (p || '').replace(/\D/g, ''))
        .filter(p => p.length >= 9);

      const uniquePhones = [];
      const seen = new Set();
      for (const p of validPhones) {
        const key = p.slice(-9);
        if (!seen.has(key)) {
          seen.add(key);
          uniquePhones.push(p);
        }
      }

      return {
        name: c.name || '',
        phone: uniquePhones[0] || null,
        phones: uniquePhones,
        photo: c.photo || null
      };
    })
    .filter(c => c.phone || (c.phones && c.phones.length > 0));
}

/**
 * Continuous real-time background sync worker for Google Contacts.
 * Syncs any phone/photo/name/birthday updates to Supabase DB & emits Socket.IO event.
 */
async function syncGoogleContactsRealtime(io = null) {
  try {
    const { getAuthClient } = require('../config/google.config');
    const auth = await getAuthClient();
    if (!auth) return;

    const contacts = await listContacts(auth, true);
    if (!Array.isArray(contacts)) return;

    // Detect if contacts changed
    const currentSignature = contacts.map(c => 
      `${c.name}:${(c.phones || []).join(',')}:${c.birthday ? c.birthday.month + '/' + c.birthday.day : ''}:${c.photo || ''}`
    ).join('|');

    if (currentSignature !== lastSyncSignature) {
      lastSyncSignature = currentSignature;
      console.log(`🔄 Real-time Google Contacts Sync: Detected changes. Syncing ${contacts.length} contact(s) to Database...`);
      
      const { syncContactsToDb } = require('./db.service');
      const count = await syncContactsToDb(contacts);

      if (io) {
        io.emit('contacts:updated', {
          count,
          total: contacts.length,
          timestamp: new Date().toISOString()
        });
      }
    }
  } catch (err) {
    console.warn('⚠️ syncGoogleContactsRealtime error:', err.message);
  }
}

/**
 * Finds contact in Google Contacts by phone number and returns profile photo URL.
 */
async function getGoogleProfilePhoto(auth, number) {
  if (!auth || !number) return null;

  try {
    const service = google.people({ version: 'v1', auth });
    const res = await service.people.connections.list({
      resourceName: 'people/me',
      pageSize: 2000,
      personFields: 'names,phoneNumbers,photos'
    });

    const connections = res.data.connections || [];
    const cleanNumber = number.replace(/\D/g, '');

    for (const person of connections) {
      const phones = person.phoneNumbers || [];
      for (const phone of phones) {
        const contactNumber = phone.value.replace(/\D/g, '');
        if (contactNumber.includes(cleanNumber) || cleanNumber.includes(contactNumber)) {
          const photo = person.photos && person.photos.length > 0
            ? person.photos[0].url
            : null;

          return {
            name: person.names ? person.names[0].displayName : null,
            phone: phone.value,
            photo: photo ? photo.replace(/=s\d+/, '=s10000') : null
          };
        }
      }
    }
    return null;
  } catch (err) {
    console.error('⚠️ getGoogleProfilePhoto error:', err.message);
    return null;
  }
}

module.exports = {
  listContacts,
  listContactsFestive,
  getTodayBirthdays,
  getGoogleProfilePhoto,
  syncGoogleContactsRealtime
};

