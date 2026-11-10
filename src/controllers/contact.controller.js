const { getAuthClient } = require('../config/google.config');
const { listContacts, listContactsFestive } = require('../services/google.service');

async function getContacts(req, res) {
  try {
    const auth = await getAuthClient(req, res);
    if (!auth) return; // redirected if unauthenticated

    const forceFresh = req.query.fresh === 'true' || req.query.force === 'true';
    const contacts = await listContacts(auth, forceFresh);
    res.json(contacts);
  } catch (err) {
    console.error('❌ Error retrieving contacts:', err.message);
    res.status(500).json({ error: 'Error retrieving contacts' });
  }
}

async function getContactsFestive(req, res) {
  try {
    const auth = await getAuthClient(req, res);
    if (!auth) return; // redirected

    const contacts = await listContactsFestive(auth);
    res.json(contacts);
  } catch (err) {
    console.error('❌ Error retrieving festive contacts:', err.message);
    res.status(500).json({ error: 'Error retrieving contacts' });
  }
}

async function getTomorrowContacts(req, res) {
  try {
    const auth = await getAuthClient(req, res);
    if (!auth) return;

    const contacts = await listContacts(auth);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowMonth = tomorrow.getMonth() + 1;
    const tomorrowDay = tomorrow.getDate();

    const tomorrowBirthdays = (contacts || []).filter(
      c => c.birthday && c.birthday.month === tomorrowMonth && c.birthday.day === tomorrowDay
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
    res.status(500).json({ error: 'Error fetching contacts.' });
  }
}

module.exports = {
  getContacts,
  getContactsFestive,
  getTomorrowContacts
};

