const { getAuthClient } = require('../config/google.config');
const { listContacts, listContactsFestive } = require('../services/google.service');
const { getSyncedContacts } = require('../services/db.service');

async function getContacts(req, res) {
  try {
    const auth = await getAuthClient(req, res);
    if (!auth) {
      if (res.headersSent) return;

      // If unauthenticated or no Google session on server, serve synced Supabase contacts
      const dbContacts = await getSyncedContacts();
      if (Array.isArray(dbContacts) && dbContacts.length > 0) {
        const formatted = dbContacts.map(c => ({
          name: c.name,
          phones: [c.phone],
          birthday: (c.birthday_month && c.birthday_day) ? { month: c.birthday_month, day: c.birthday_day } : null,
          photo: c.photo_url
        }));
        return res.json(formatted);
      }
      return res.json([]);
    }

    const forceFresh = req.query.fresh === 'true' || req.query.force === 'true';
    const contacts = await listContacts(auth, forceFresh);
    res.json(contacts);
  } catch (err) {
    console.error('❌ Error retrieving contacts:', err.message);
    try {
      const dbContacts = await getSyncedContacts();
      if (Array.isArray(dbContacts) && dbContacts.length > 0) {
        const formatted = dbContacts.map(c => ({
          name: c.name,
          phones: [c.phone],
          birthday: (c.birthday_month && c.birthday_day) ? { month: c.birthday_month, day: c.birthday_day } : null,
          photo: c.photo_url
        }));
        return res.json(formatted);
      }
    } catch (e) {}

    res.json([]);
  }
}

async function getContactsFestive(req, res) {
  try {
    const auth = await getAuthClient(req, res);
    if (!auth) {
      if (res.headersSent) return;
      const dbContacts = await getSyncedContacts();
      if (Array.isArray(dbContacts) && dbContacts.length > 0) {
        const formatted = dbContacts.map(c => ({
          name: c.name,
          phones: [c.phone],
          photo: c.photo_url
        }));
        return res.json(formatted);
      }
      return res.json([]);
    }

    const contacts = await listContactsFestive(auth);
    res.json(contacts);
  } catch (err) {
    console.error('❌ Error retrieving festive contacts:', err.message);
    try {
      const dbContacts = await getSyncedContacts();
      if (Array.isArray(dbContacts) && dbContacts.length > 0) {
        const formatted = dbContacts.map(c => ({
          name: c.name,
          phones: [c.phone],
          photo: c.photo_url
        }));
        return res.json(formatted);
      }
    } catch (e) {}
    res.json([]);
  }
}

async function getTomorrowContacts(req, res) {
  try {
    const auth = await getAuthClient(req, res);
    let contacts = [];
    if (auth) {
      contacts = await listContacts(auth);
    } else {
      const dbContacts = await getSyncedContacts();
      contacts = (dbContacts || []).map(c => ({
        name: c.name,
        phones: [c.phone],
        birthday: (c.birthday_month && c.birthday_day) ? { month: c.birthday_month, day: c.birthday_day } : null,
        photo: c.photo_url
      }));
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowMonth = tomorrow.getMonth() + 1;
    const tomorrowDay = tomorrow.getDate();

    const tomorrowBirthdays = (contacts || []).filter(
      c => c.birthday && Number(c.birthday.month) === tomorrowMonth && Number(c.birthday.day) === tomorrowDay
    );

    if (!tomorrowBirthdays.length) {
      return res.json({ message: 'No contacts have a birthday tomorrow.' });
    }

    const birthdayListString = tomorrowBirthdays
      .map((c, i) => `${i + 1}. ${c.name}`)
      .join('\n');

    res.json({ list: birthdayListString });
  } catch (err) {
    console.error('❌ Error fetching tomorrow contacts:', err.message);
    res.json({ message: 'Could not calculate tomorrow contacts.' });
  }
}

module.exports = {
  getContacts,
  getContactsFestive,
  getTomorrowContacts
};
