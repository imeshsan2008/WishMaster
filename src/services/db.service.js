const crypto = require('crypto');
const path = require('path');
const { getSql, isDbConnected } = require('../config/db');
const { PATHS, HOSTNAME } = require('../config/env.config');
const { safeReadJson, safeWriteJson } = require('../utils/file.util');

const FALLBACK_DB_FILE = path.join(PATHS.FILES_DIR, 'local_db_store.json');

function getLocalStore() {
  return safeReadJson(FALLBACK_DB_FILE, {
    admin_password: '1224',
    birthday_song_url: 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=happy-birthday-15264.mp3',
    bot_footer: '> WishMaster V4.0',
    wish_expiry_days: 7,
    textlk_api_token: '',
    textlk_sender_id: 'TextLKDemo',
    textlk_sms_template: '🎂 Happy Birthday, {name}! Open your special surprise gift: {link} (Validity: Never)',
    sms_auto_send: true,
    sms_credits: { current_month: '2026-11', monthly_count: 0, total_count: 0 },
    sms_history: [],
    contacts: [],
    birthday_wishes: [],
    festive_campaigns: []
  });
}

function saveLocalStore(data) {
  return safeWriteJson(FALLBACK_DB_FILE, data);
}

// ======================== ADMIN SETTINGS ========================

async function getAdminPassword() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'admin_password'`;
      if (rows && rows.length > 0) return rows[0].value;
    } catch (err) {
      console.error('⚠️ DB error getAdminPassword:', err.message);
    }
  }
  return getLocalStore().admin_password || '1224';
}

async function setAdminPassword(password) {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('admin_password', ${password})
        ON CONFLICT (key) DO UPDATE SET value = ${password}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.error('⚠️ DB error setAdminPassword:', err.message);
    }
  }
  const store = getLocalStore();
  store.admin_password = password;
  saveLocalStore(store);
  return true;
}

function normalizeAudioUrl(url) {
  if (!url) return '/assets/voice/voice.ogg';
  let cleaned = String(url).trim();
  // Convert GitHub blob web pages to direct raw content URLs
  if (cleaned.includes('github.com/') && cleaned.includes('/blob/')) {
    cleaned = cleaned
      .replace('github.com/', 'raw.githubusercontent.com/')
      .replace('/blob/', '/');
  }
  return cleaned;
}

async function getBirthdaySongUrl() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'birthday_song_url'`;
      if (rows && rows.length > 0 && rows[0].value) {
        return normalizeAudioUrl(rows[0].value);
      }
    } catch (err) {
      console.error('⚠️ DB error getBirthdaySongUrl:', err.message);
    }
  }
  const local = getLocalStore().birthday_song_url;
  return normalizeAudioUrl(local || '/assets/voice/voice.ogg');
}

async function setBirthdaySongUrl(url) {
  const cleanUrl = normalizeAudioUrl(url);
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('birthday_song_url', ${cleanUrl})
        ON CONFLICT (key) DO UPDATE SET value = ${cleanUrl}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.error('⚠️ DB error setBirthdaySongUrl:', err.message);
    }
  }
  const store = getLocalStore();
  store.birthday_song_url = cleanUrl;
  saveLocalStore(store);
  return true;
}

// ======================== BOT FOOTER & WISH EXPIRY ========================

async function getBotFooter() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'bot_footer'`;
      if (rows && rows.length > 0 && rows[0].value) {
        return rows[0].value;
      }
    } catch (err) {
      console.warn('⚠️ DB error getBotFooter:', err.message);
    }
  }
  const store = getLocalStore();
  return store.bot_footer || '> WishMaster V4.0';
}

async function saveBotFooter(tagline) {
  const val = String(tagline || '> WishMaster V4.0').trim();
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('bot_footer', ${val})
        ON CONFLICT (key) DO UPDATE SET value = ${val}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.warn('⚠️ DB error saveBotFooter:', err.message);
    }
  }
  const store = getLocalStore();
  store.bot_footer = val;
  saveLocalStore(store);
  return true;
}

async function getWishExpiryDays() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'wish_expiry_days'`;
      if (rows && rows.length > 0 && rows[0].value) {
        const parsed = parseInt(rows[0].value, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch (err) {
      console.warn('⚠️ DB error getWishExpiryDays:', err.message);
    }
  }
  const store = getLocalStore();
  const parsed = parseInt(store.wish_expiry_days, 10);
  return (!isNaN(parsed) && parsed > 0) ? parsed : 7;
}

async function saveWishExpiryDays(days) {
  const parsed = Math.max(1, parseInt(days, 10) || 7);
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('wish_expiry_days', ${String(parsed)})
        ON CONFLICT (key) DO UPDATE SET value = ${String(parsed)}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.warn('⚠️ DB error saveWishExpiryDays:', err.message);
    }
  }
  const store = getLocalStore();
  store.wish_expiry_days = parsed;
  saveLocalStore(store);
  return true;
}

// ======================== FRAME STYLES SYNC ========================

async function getDbFrameStyles() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'frame_styles'`;
      if (rows && rows.length > 0 && rows[0].value) {
        return typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
      }
    } catch (err) {
      console.warn('⚠️ DB error getDbFrameStyles:', err.message);
    }
  }

  // Fallback to local frame_style_sheet.json
  const fileStyles = safeReadJson(PATHS.FRAME_STYLES, { frameStyles: {}, user_selected_style: '1' });

  // Auto-seed to Supabase DB if connected
  if (isDbConnected() && sql && fileStyles.frameStyles) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('frame_styles', ${JSON.stringify(fileStyles)})
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(fileStyles)}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (e) {}
  }

  return fileStyles;
}

async function saveDbFrameStyles(stylesData) {
  if (!stylesData || typeof stylesData !== 'object') return false;

  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('frame_styles', ${JSON.stringify(stylesData)})
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(stylesData)}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.warn('⚠️ DB error saveDbFrameStyles:', err.message);
    }
  }

  // Persist to local file
  safeWriteJson(PATHS.FRAME_STYLES, stylesData);
  return true;
}

// ======================== SECRET LETTERS SYNC & ROTATION ========================

const DEFAULT_SECRET_LETTERS = {
  currentIndex: 0,
  letters: [
    {
      id: "letter_1",
      title: "Inspiring & Heartfelt",
      text: "On this special milestone of your life, remember that you are appreciated, valued, and loved. Thank you for bringing laughter and joy into the lives of those around you. Wishing you endless health, radiant happiness, prosperity, and success in everything you set out to achieve!",
      title: "හෘදයාංගම ආශිර්වාදය",
      text: "ඔබගේ ජීවිතයේ මෙම විශේෂ සංධිස්ථානයේදී, ඔබ අප සැමටම ඉතා වටිනා ආදරණීය චරිතයක් බව මතක තබා ගන්න. ඔබ අවට සිටින සැමගේ මුහුණට සිනහව සහ සතුට ගෙන ඒම පිළිබඳව ඔබට අපගේ හෘදයාංගම ස්තූතිය! ඔබට නිදුක් නිරෝගී සුවය, නිමක් නැති සතුට, සෞභාග්‍යය සහ ඔබ බලාපොරොත්තු වන සියලු යහපත් ප්‍රාර්ථනා ඉටුවන සුබ උපන්දිනයක් වේවා!"
    },
    {
      id: "letter_2",
      title: "Joy & Magical Blessings",
      text: "Happy Birthday! May your day be touched with a bit of magic, lots of warmth, and wonderful moments with loved ones. Keep shining bright and inspiring everyone around you with your wonderful spirit and kind heart!",
      title: "ප්‍රීතිය සහ ආලෝකය",
      text: "සුභ උපන්දිනයක් වේවා! ඔබගේ ජීවිතයේ ඉදිරි වසර ආශිර්වාදයෙන්, සතුටින් සහ සුන්දර මතකයන්ගෙන් පිරි එකක් වේවා. ඔබ සතු කාරුණික හදවතින් සහ උතුම් ගුණාංගවලින් සැමදා ලෝකය ආලෝකමත් කිරීමට ඔබට ශක්තිය ධෛර්යය ලැබේවා!"
    },
    {
      id: "letter_3",
      title: "Prosperity & Big Dreams",
      text: "Wishing you another year filled with adventures, unforgettable memories, good health, and immense joy. May all the dreams you have been nurturing bloom into incredible realities this year!",
      title: "සාර්ථකත්වය සහ සිහින",
      text: "ඔබගේ උපන්දිනය වෙනුවෙන් මාගේ උණුසුම් සුබපැතුම්! ඔබ මෙතෙක් ආ ගමන මෙන්ම ඉදිරි ජීවිත කාලයද සාර්ථකත්වයෙන්, නිරෝගීභාවයෙන් හා ප්‍රීතියෙන් පිරී ඉතිරී යේවායි මුළු හදවතින්ම ප්‍රාර්ථනා කරමි!"
    },
    {
      id: "letter_4",
      title: "Gratitude & Warm Smiles",
      text: "Birthdays are a celebration of the wonderful journey of life and the impact you have on the people around you. Thank you for simply being you. May this upcoming year bring you unmatched happiness and peaceful triumphs!",
      title: "සාමය සහ සතුට",
      text: "ජීවිතයේ තවත් එක් සුන්දර වසරක් සනිටුහන් කරන මෙම සුවිශේෂී දිනයේදී, ඔබ දකින සියලු සිහින යථාර්ථයක් වන, සාමය සහ ප්‍රීතිය සපිරි සුබම සුබ උපන්දිනයක් වේවා!"
    }
  ]
};

async function getDbSecretLetters() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'secret_letters'`;
      if (rows && rows.length > 0 && rows[0].value) {
        return typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
      }
    } catch (err) {
      console.warn('⚠️ DB error getDbSecretLetters:', err.message);
    }
  }

  // Fallback to local files/secret_letters.json or DEFAULT_SECRET_LETTERS
  const fileLetters = safeReadJson(PATHS.SECRET_LETTERS, DEFAULT_SECRET_LETTERS);
  if (!fileLetters.letters || !Array.isArray(fileLetters.letters) || fileLetters.letters.length === 0) {
    fileLetters.letters = DEFAULT_SECRET_LETTERS.letters;
    fileLetters.currentIndex = 0;
  }

  // Auto-seed to DB if connected
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('secret_letters', ${JSON.stringify(fileLetters)})
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(fileLetters)}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (e) {}
  }

  return fileLetters;
}

async function saveDbSecretLetters(data) {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.letters)) data.letters = [];
  if (typeof data.currentIndex !== 'number') data.currentIndex = 0;

  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('secret_letters', ${JSON.stringify(data)})
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(data)}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.warn('⚠️ DB error saveDbSecretLetters:', err.message);
    }
  }

  safeWriteJson(PATHS.SECRET_LETTERS, data);
  return true;
}

async function getNextSecretLetter(contactName) {
  try {
    const data = await getDbSecretLetters();
    const letters = data.letters || [];
    if (letters.length === 0) {
      return "Wishing you endless health, radiant happiness, prosperity, and success in everything you set out to achieve!";
    }

    const idx = (data.currentIndex || 0) % letters.length;
    const selected = letters[idx];

    // Advance index for next wish (one-by-one rotating)
    data.currentIndex = (idx + 1) % letters.length;
    await saveDbSecretLetters(data);

    let rawText = (selected && typeof selected === 'object' ? selected.text : selected) || '';
    if (typeof rawText !== 'string') rawText = JSON.stringify(rawText);
    return rawText.replace(/\$\{name\}/g, contactName || 'Friend');
  } catch (err) {
    console.warn('⚠️ getNextSecretLetter fallback:', err.message);
    return "Wishing you endless health, radiant happiness, prosperity, and success in everything you set out to achieve!";
  }
}

// ======================== CONTACTS SYNC ========================

async function syncContactsToDb(contactsList) {
  if (!Array.isArray(contactsList)) return 0;

  const sql = getSql();
  let count = 0;

  if (isDbConnected() && sql) {
    try {
      for (const c of contactsList) {
        if (!c.phones || c.phones.length === 0) continue;
        const phone = c.phones[0].replace(/\D/g, '');
        if (!phone) continue;

        const bMonth = c.birthday ? c.birthday.month : null;
        const bDay = c.birthday ? c.birthday.day : null;

        await sql`
          INSERT INTO contacts (name, phone, birthday_month, birthday_day, photo_url, synced_at)
          VALUES (${c.name || 'Unknown'}, ${phone}, ${bMonth}, ${bDay}, ${c.photo || null}, CURRENT_TIMESTAMP)
          ON CONFLICT (phone) DO UPDATE 
            SET name = ${c.name || 'Unknown'},
                birthday_month = ${bMonth},
                birthday_day = ${bDay},
                photo_url = ${c.photo || null},
                synced_at = CURRENT_TIMESTAMP;
        `;
        count++;
      }
      return count;
    } catch (err) {
      console.error('⚠️ DB error syncContactsToDb:', err.message);
    }
  }

  // Fallback to local store
  const store = getLocalStore();
  store.contacts = contactsList;
  saveLocalStore(store);
  return contactsList.length;
}

async function getSyncedContacts() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      return await sql`SELECT * FROM contacts ORDER BY name ASC`;
    } catch (err) {
      console.error('⚠️ DB error getSyncedContacts:', err.message);
    }
  }
  return getLocalStore().contacts || [];
}

// ======================== BIRTHDAY WISHES (DYNAMIC EXPIRY) ========================

async function createBirthdayWishRecord({ contactName, phone, photoUrl, framedImageUrl, message, songUrl, neverExpire = false, waStatus = 'sent', smsStatus = 'not_sent' }) {
  const uniqueCode = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const expiryDays = await getWishExpiryDays();
  const expiresAt = neverExpire 
    ? new Date('2099-12-31T23:59:59Z') 
    : new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000);
  const effectiveSongUrl = songUrl || await getBirthdaySongUrl();

  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const inserted = await sql`
        INSERT INTO birthday_wishes (
          unique_code, contact_name, phone, photo_url, framed_image_url, message, song_url, expires_at, steps_completed, wa_status, sms_status
        )
        VALUES (
          ${uniqueCode}, ${contactName}, ${phone}, ${photoUrl || null}, ${framedImageUrl || null}, ${message}, ${effectiveSongUrl}, ${expiresAt.toISOString()}, FALSE, ${waStatus}, ${smsStatus}
        )
        RETURNING *;
      `;
      return inserted[0];
    } catch (err) {
      console.error('⚠️ DB error createBirthdayWishRecord:', err.message);
    }
  }

  // Fallback local store
  const store = getLocalStore();
  if (!Array.isArray(store.birthday_wishes)) store.birthday_wishes = [];

  const wish = {
    id: Date.now(),
    unique_code: uniqueCode,
    contact_name: contactName,
    phone,
    photo_url: photoUrl || null,
    framed_image_url: framedImageUrl || null,
    message,
    song_url: effectiveSongUrl,
    is_opened: false,
    opened_at: null,
    open_count: 0,
    steps_completed: false,
    wa_status: waStatus,
    sms_status: smsStatus,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString()
  };

  store.birthday_wishes.push(wish);
  saveLocalStore(store);
  return wish;
}

async function markWishStepsCompleted(code, completed = true) {
  if (!code) return null;
  const isComp = Boolean(completed);

  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const updated = await sql`
        UPDATE birthday_wishes
        SET steps_completed = ${isComp}
        WHERE unique_code = ${code}
        RETURNING *;
      `;
      if (updated && updated.length > 0) return updated[0];
    } catch (err) {
      console.error('⚠️ DB error markWishStepsCompleted:', err.message);
    }
  }

  const store = getLocalStore();
  const wish = (store.birthday_wishes || []).find(w => w.unique_code === code);
  if (wish) {
    wish.steps_completed = isComp;
    saveLocalStore(store);
  }
  return wish;
}

async function getWishByCode(code) {
  if (!code) return null;

  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT * FROM birthday_wishes WHERE unique_code = ${code}`;
      if (rows && rows.length > 0) return rows[0];
    } catch (err) {
      console.error('⚠️ DB error getWishByCode:', err.message);
    }
  }

  const store = getLocalStore();
  return (store.birthday_wishes || []).find(w => w.unique_code === code) || null;
}

async function markWishCardDelivered(code, phone) {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      if (code) {
        await sql`
          UPDATE birthday_wishes
          SET card_delivered_wa = TRUE
          WHERE unique_code = ${code};
        `;
      } else if (phone) {
        const clean = String(phone).replace(/\D/g, '');
        if (clean) {
          await sql`
            UPDATE birthday_wishes
            SET card_delivered_wa = TRUE
            WHERE phone LIKE ${'%' + clean.slice(-9)};
          `;
        }
      }
    } catch (err) {
      console.error('⚠️ DB error markWishCardDelivered:', err.message);
    }
  }

  const store = getLocalStore();
  if (Array.isArray(store.birthday_wishes)) {
    const cleanP = phone ? String(phone).replace(/\D/g, '').slice(-9) : '';
    store.birthday_wishes.forEach(w => {
      const matchCode = code && w.unique_code === code;
      const matchPhone = cleanP && String(w.phone || '').replace(/\D/g, '').endsWith(cleanP);
      if (matchCode || matchPhone) {
        w.card_delivered_wa = true;
      }
    });
    saveLocalStore(store);
  }
}

async function markWishOpened(code) {
  if (!code) return null;

  const now = new Date();
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const updated = await sql`
        UPDATE birthday_wishes
        SET is_opened = TRUE,
            opened_at = COALESCE(opened_at, CURRENT_TIMESTAMP),
            open_count = open_count + 1
        WHERE unique_code = ${code}
        RETURNING *;
      `;
      if (updated && updated.length > 0) return updated[0];
    } catch (err) {
      console.error('⚠️ DB error markWishOpened:', err.message);
    }
  }

  const store = getLocalStore();
  const wish = (store.birthday_wishes || []).find(w => w.unique_code === code);
  if (wish) {
    wish.is_opened = true;
    if (!wish.opened_at) wish.opened_at = now.toISOString();
    wish.open_count = (wish.open_count || 0) + 1;
    saveLocalStore(store);
  }
  return wish;
}

async function updateWishDeliveryStatus({ uniqueCode, phone, waStatus, smsStatus }) {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      if (uniqueCode) {
        if (waStatus && smsStatus) {
          await sql`UPDATE birthday_wishes SET wa_status = ${waStatus}, sms_status = ${smsStatus} WHERE unique_code = ${uniqueCode}`;
        } else if (waStatus) {
          await sql`UPDATE birthday_wishes SET wa_status = ${waStatus} WHERE unique_code = ${uniqueCode}`;
        } else if (smsStatus) {
          await sql`UPDATE birthday_wishes SET sms_status = ${smsStatus} WHERE unique_code = ${uniqueCode}`;
        }
      } else if (phone) {
        const clean = String(phone).replace(/\D/g, '');
        if (clean) {
          const match = '%' + clean.slice(-9);
          if (waStatus && smsStatus) {
            await sql`UPDATE birthday_wishes SET wa_status = ${waStatus}, sms_status = ${smsStatus} WHERE phone LIKE ${match}`;
          } else if (waStatus) {
            await sql`UPDATE birthday_wishes SET wa_status = ${waStatus} WHERE phone LIKE ${match}`;
          } else if (smsStatus) {
            await sql`UPDATE birthday_wishes SET sms_status = ${smsStatus} WHERE phone LIKE ${match}`;
          }
        }
      }
    } catch (err) {
      console.error('⚠️ DB error updateWishDeliveryStatus:', err.message);
    }
  }

  const store = getLocalStore();
  if (Array.isArray(store.birthday_wishes)) {
    const cleanP = phone ? String(phone).replace(/\D/g, '').slice(-9) : '';
    store.birthday_wishes.forEach(w => {
      const matchCode = uniqueCode && w.unique_code === uniqueCode;
      const matchPhone = cleanP && String(w.phone || '').replace(/\D/g, '').endsWith(cleanP);
      if (matchCode || matchPhone) {
        if (waStatus) w.wa_status = waStatus;
        if (smsStatus) w.sms_status = smsStatus;
      }
    });
    saveLocalStore(store);
  }
}

async function getActiveWishesLast7Days() {
  const sql = getSql();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  if (isDbConnected() && sql) {
    try {
      const wishes = await sql`
        WITH ranked_wishes AS (
          SELECT bw.*,
            COALESCE(bw.wa_status, 'sent') as wa_status,
            COALESCE(bw.sms_status, (
              SELECT sh.status FROM sms_history sh 
              WHERE sh.phone LIKE '%' || RIGHT(REGEXP_REPLACE(bw.phone, '[^0-9]', '', 'g'), 9)
              ORDER BY sh.created_at DESC LIMIT 1
            ), 'not_sent') as sms_status,
            ROW_NUMBER() OVER (
              PARTITION BY COALESCE(NULLIF(RIGHT(REGEXP_REPLACE(bw.phone, '[^0-9]', '', 'g'), 9), ''), LOWER(TRIM(bw.contact_name)))
              ORDER BY bw.created_at DESC
            ) as rn
          FROM birthday_wishes bw
          WHERE bw.created_at >= ${sevenDaysAgo}
        )
        SELECT * FROM ranked_wishes
        WHERE rn = 1
        ORDER BY created_at DESC;
      `;
      return wishes;
    } catch (err) {
      console.error('⚠️ DB error getActiveWishesLast7Days:', err.message);
    }
  }

  const store = getLocalStore();
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const filtered = (store.birthday_wishes || [])
    .filter(w => new Date(w.created_at).getTime() >= sevenDaysAgoMs)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const seenKeys = new Set();
  const uniqueWishes = [];
  for (const w of filtered) {
    const key = String(w.phone || '').replace(/\D/g, '').slice(-9) || (w.contact_name || '').toLowerCase().trim();
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    let smsStatus = w.sms_status || 'not_sent';
    if (smsStatus === 'not_sent' && Array.isArray(store.sms_history)) {
      const cleanP = String(w.phone || '').replace(/\D/g, '').slice(-9);
      const found = store.sms_history.slice().reverse().find(s => cleanP && String(s.phone || '').replace(/\D/g, '').endsWith(cleanP));
      if (found) smsStatus = found.status;
    }

    uniqueWishes.push({
      ...w,
      wa_status: w.wa_status || 'sent',
      sms_status: smsStatus
    });
  }
  return uniqueWishes;
}

async function saveFestiveCampaign(campaign) {
  const sql = getSql();
  const cId = campaign.campaign_id || `camp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const campData = {
    ...campaign,
    campaign_id: cId,
    created_at: campaign.created_at || new Date().toISOString()
  };

  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO festive_campaigns (
          campaign_id, title, caption, image_url, channels, total_contacts,
          wa_success_count, wa_failed_count, sms_success_count, sms_failed_count,
          sms_credits_used, logs, created_at
        )
        VALUES (
          ${campData.campaign_id}, ${campData.title}, ${campData.caption}, ${campData.image_url || null},
          ${campData.channels || ['whatsapp']}, ${campData.total_contacts || 0},
          ${campData.wa_success_count || 0}, ${campData.wa_failed_count || 0},
          ${campData.sms_success_count || 0}, ${campData.sms_failed_count || 0},
          ${campData.sms_credits_used || 0}, ${sql.json(campData.logs || [])},
          ${campData.created_at}
        )
        ON CONFLICT (campaign_id) DO UPDATE SET
          title = EXCLUDED.title,
          caption = EXCLUDED.caption,
          image_url = EXCLUDED.image_url,
          channels = EXCLUDED.channels,
          total_contacts = EXCLUDED.total_contacts,
          wa_success_count = EXCLUDED.wa_success_count,
          wa_failed_count = EXCLUDED.wa_failed_count,
          sms_success_count = EXCLUDED.sms_success_count,
          sms_failed_count = EXCLUDED.sms_failed_count,
          sms_credits_used = EXCLUDED.sms_credits_used,
          logs = EXCLUDED.logs;
      `;
    } catch (err) {
      console.error('⚠️ DB error saveFestiveCampaign:', err.message);
    }
  }

  const store = getLocalStore();
  if (!Array.isArray(store.festive_campaigns)) store.festive_campaigns = [];
  const idx = store.festive_campaigns.findIndex(c => c.campaign_id === cId);
  if (idx >= 0) {
    store.festive_campaigns[idx] = campData;
  } else {
    store.festive_campaigns.unshift(campData);
  }
  saveLocalStore(store);
  return campData;
}

async function getFestiveCampaigns() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT * FROM festive_campaigns ORDER BY created_at DESC`;
      if (rows && rows.length > 0) return rows;
    } catch (err) {
      console.error('⚠️ DB error getFestiveCampaigns:', err.message);
    }
  }

  const store = getLocalStore();
  return store.festive_campaigns || [];
}

async function getLatestWishByPhone(phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return null;

  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const matchSuffix = '%' + clean.slice(-9);
      const rows = await sql`
        SELECT * FROM birthday_wishes
        WHERE phone LIKE ${matchSuffix}
        ORDER BY created_at DESC
        LIMIT 1;
      `;
      if (rows && rows.length > 0) return rows[0];
    } catch (err) {
      console.warn('⚠️ DB error getLatestWishByPhone:', err.message);
    }
  }

  const store = getLocalStore();
  const list = (store.birthday_wishes || [])
    .filter(w => String(w.phone || '').replace(/\D/g, '').endsWith(clean.slice(-9)))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return list[0] || null;
}

// ======================== MESSAGE TEMPLATE & CONTACT PREFERENCES ========================

const DEFAULT_MESSAGE_TEMPLATE = 
`🎂✨ *සුභ උපන්දිනයක් වේවා, {name}!* 🎉🎈\n\n` +
`🎁 *ඔබ වෙනුවෙන්ම සූදානම් කළ විශේෂ උපන්දින ත්‍යාගයක් බලාපොරොත්තුවෙන් සිටී!* 💫\n` +
`ඔබගේ උපන්දින තිළිණය විවෘත කිරීමට පහත ලින්ක් එක click කරන්න:\n` +
`👉 {link}\n\n` +
`_(සටහන: මෙම සැමරුම් ලින්ක් එක දින {expiry_days}ක් වලංගු වේ)_\n\n` +
`📲 *ලින්ක් එක open කිරීමට අපහසු නම්, ඔබගේ විශේෂ ඡායාරූප කාඩ්පත WhatsApp එකෙන්ම මෙහිදීම ලබා ගැනීමට 1 ලෙස reply කරන්න!*\n\n` +
`{footer}`;

async function getBirthdayMessageTemplate() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'birthday_message_template'`;
      if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (err) {
      console.warn('⚠️ DB error getBirthdayMessageTemplate:', err.message);
    }
  }
  const store = getLocalStore();
  return store.birthday_message_template || DEFAULT_MESSAGE_TEMPLATE;
}

async function saveBirthdayMessageTemplate(template) {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('birthday_message_template', ${template})
        ON CONFLICT (key) DO UPDATE SET value = ${template}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.warn('⚠️ DB error saveBirthdayMessageTemplate:', err.message);
    }
  }
  const store = getLocalStore();
  store.birthday_message_template = template;
  saveLocalStore(store);
  return true;
}

async function getContactPreferences() {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'contact_preferences'`;
      if (rows && rows.length > 0 && rows[0].value) {
        return typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
      }
    } catch (err) {
      console.warn('⚠️ DB error getContactPreferences:', err.message);
    }
  }
  const store = getLocalStore();
  return store.contact_preferences || {};
}

async function saveAllContactPreferences(prefs) {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('contact_preferences', ${JSON.stringify(prefs)})
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(prefs)}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.warn('⚠️ DB error saveAllContactPreferences:', err.message);
    }
  }
  const store = getLocalStore();
  store.contact_preferences = prefs;
  saveLocalStore(store);
  return true;
}

async function getContactPreferenceByPhone(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/\D/g, '');
  const all = await getContactPreferences();
  for (const [pKey, pVal] of Object.entries(all)) {
    const cleanKey = String(pKey).replace(/\D/g, '');
    if (cleanKey === clean || (clean.length >= 9 && cleanKey.endsWith(clean.slice(-9)))) {
      return pVal;
    }
  }
  return null;
}

async function saveContactPreference(phone, prefData) {
  if (!phone) return false;
  const clean = String(phone).replace(/\D/g, '');
  const all = await getContactPreferences();
  all[clean] = {
    phone: clean,
    name: prefData.name || '',
    letter_type: prefData.letter_type || 'auto',
    saved_letter_id: prefData.saved_letter_id || null,
    custom_letter_text: prefData.custom_letter_text || '',
    assigned_frame_id: prefData.assigned_frame_id || 'default',
    updated_at: new Date().toISOString()
  };
  await saveAllContactPreferences(all);
  return all[clean];
}

module.exports = {
  getAdminPassword,
  setAdminPassword,
  getBirthdaySongUrl,
  setBirthdaySongUrl,
  getBotFooter,
  saveBotFooter,
  getWishExpiryDays,
  saveWishExpiryDays,
  getDbFrameStyles,
  saveDbFrameStyles,
  getDbSecretLetters,
  saveDbSecretLetters,
  getNextSecretLetter,
  getBirthdayMessageTemplate,
  saveBirthdayMessageTemplate,
  DEFAULT_MESSAGE_TEMPLATE,
  getContactPreferences,
  getContactPreferenceByPhone,
  saveContactPreference,
  syncContactsToDb,
  getSyncedContacts,
  createBirthdayWishRecord,
  getWishByCode,
  getLatestWishByPhone,
  markWishOpened,
  markWishStepsCompleted,
  markWishCardDelivered,
  updateWishDeliveryStatus,
  saveFestiveCampaign,
  getFestiveCampaigns,
  getActiveWishesLast7Days,
  getLocalStore,
  saveLocalStore
};

