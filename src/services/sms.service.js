const path = require('path');
const { getSql, isDbConnected } = require('../config/db');
const { PATHS } = require('../config/env.config');
const { safeReadJson, safeWriteJson } = require('../utils/file.util');

const FALLBACK_DB_FILE = path.join(PATHS.FILES_DIR, 'local_db_store.json');

function getLocalStore() {
  return safeReadJson(FALLBACK_DB_FILE, {
    textlk_api_token: '',
    textlk_sender_id: 'TextLKDemo',
    textlk_sms_template: '🎂 Happy Birthday, {name}! Open your special surprise gift: {link} (Validity: Never)',
    sms_auto_send: true,
    sms_credits: { current_month: '2026-11', monthly_count: 0, total_count: 0 },
    sms_history: []
  });
}

function saveLocalStore(data) {
  return safeWriteJson(FALLBACK_DB_FILE, data);
}

function getCurrentMonthKey() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// ======================== TEXT.LK CONFIG ========================

async function getTextLkConfig() {
  const sql = getSql();
  let token = process.env.TEXTLK_API_TOKEN || '';
  let senderId = process.env.TEXTLK_SENDER_ID || 'TextLKDemo';
  let template = '🎂 Happy Birthday, {name}! Open your special surprise gift: {link} (Validity: Never)';
  let autoSend = true;

  if (isDbConnected() && sql) {
    try {
      const rows = await sql`
        SELECT key, value FROM admin_settings 
        WHERE key IN ('textlk_api_token', 'textlk_sender_id', 'textlk_sms_template', 'sms_auto_send')
      `;
      rows.forEach(r => {
        if (r.key === 'textlk_api_token') token = r.value || token;
        if (r.key === 'textlk_sender_id') senderId = r.value || senderId;
        if (r.key === 'textlk_sms_template') template = r.value || template;
        if (r.key === 'sms_auto_send') autoSend = (r.value === 'true' || r.value === true);
      });
      return { token, senderId, template, autoSend };
    } catch (err) {
      console.warn('⚠️ DB error getTextLkConfig:', err.message);
    }
  }

  const store = getLocalStore();
  return {
    token: store.textlk_api_token || token,
    senderId: store.textlk_sender_id || senderId,
    template: store.textlk_sms_template || template,
    autoSend: store.sms_auto_send !== undefined ? store.sms_auto_send : autoSend
  };
}

async function saveTextLkConfig({ token, senderId, template, autoSend }) {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      if (token !== undefined) {
        await sql`
          INSERT INTO admin_settings (key, value)
          VALUES ('textlk_api_token', ${String(token).trim()})
          ON CONFLICT (key) DO UPDATE SET value = ${String(token).trim()}, updated_at = CURRENT_TIMESTAMP;
        `;
      }
      if (senderId !== undefined) {
        await sql`
          INSERT INTO admin_settings (key, value)
          VALUES ('textlk_sender_id', ${String(senderId).trim()})
          ON CONFLICT (key) DO UPDATE SET value = ${String(senderId).trim()}, updated_at = CURRENT_TIMESTAMP;
        `;
      }
      if (template !== undefined) {
        await sql`
          INSERT INTO admin_settings (key, value)
          VALUES ('textlk_sms_template', ${String(template).trim()})
          ON CONFLICT (key) DO UPDATE SET value = ${String(template).trim()}, updated_at = CURRENT_TIMESTAMP;
        `;
      }
      if (autoSend !== undefined) {
        await sql`
          INSERT INTO admin_settings (key, value)
          VALUES ('sms_auto_send', ${String(Boolean(autoSend))})
          ON CONFLICT (key) DO UPDATE SET value = ${String(Boolean(autoSend))}, updated_at = CURRENT_TIMESTAMP;
        `;
      }
    } catch (err) {
      console.warn('⚠️ DB error saveTextLkConfig:', err.message);
    }
  }

  const store = getLocalStore();
  if (token !== undefined) store.textlk_api_token = String(token).trim();
  if (senderId !== undefined) store.textlk_sender_id = String(senderId).trim();
  if (template !== undefined) store.textlk_sms_template = String(template).trim();
  if (autoSend !== undefined) store.sms_auto_send = Boolean(autoSend);
  saveLocalStore(store);
  return true;
}

// ======================== CREDITS TRACKING (AUTO MONTHLY RESET) ========================

async function getSmsCreditsStats() {
  const currentMonth = getCurrentMonthKey();
  const sql = getSql();
  let creditsData = { current_month: currentMonth, monthly_count: 0, total_count: 0 };

  if (isDbConnected() && sql) {
    try {
      const rows = await sql`SELECT value FROM admin_settings WHERE key = 'sms_credits'`;
      if (rows && rows.length > 0 && rows[0].value) {
        creditsData = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value;
      }
    } catch (err) {
      console.warn('⚠️ DB error getSmsCreditsStats:', err.message);
    }
  } else {
    const store = getLocalStore();
    creditsData = store.sms_credits || creditsData;
  }

  // Monthly Reset Check: If current month is different, reset monthly counter to 0!
  if (creditsData.current_month !== currentMonth) {
    creditsData.current_month = currentMonth;
    creditsData.monthly_count = 0;
    // Total count remains untouched
    await saveSmsCreditsData(creditsData);
  }

  return creditsData;
}

async function saveSmsCreditsData(creditsData) {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      await sql`
        INSERT INTO admin_settings (key, value)
        VALUES ('sms_credits', ${JSON.stringify(creditsData)})
        ON CONFLICT (key) DO UPDATE SET value = ${JSON.stringify(creditsData)}, updated_at = CURRENT_TIMESTAMP;
      `;
    } catch (err) {
      console.warn('⚠️ DB error saveSmsCreditsData:', err.message);
    }
  }
  const store = getLocalStore();
  store.sms_credits = creditsData;
  saveLocalStore(store);
}

async function incrementSmsCredits(count = 1) {
  const creditsData = await getSmsCreditsStats();
  creditsData.monthly_count = (creditsData.monthly_count || 0) + count;
  creditsData.total_count = (creditsData.total_count || 0) + count;
  await saveSmsCreditsData(creditsData);
  return creditsData;
}

// ======================== SMS HISTORY LOGGING ========================

async function recordSmsHistory({ recipientName, phone, message, status, responseMessage, creditsUsed = 1 }) {
  const sql = getSql();
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const now = new Date();

  if (isDbConnected() && sql) {
    try {
      const inserted = await sql`
        INSERT INTO sms_history (
          recipient_name, phone, message, status, response_message, credits_used, created_at
        )
        VALUES (
          ${recipientName || 'Unknown'}, ${cleanPhone}, ${message}, ${status}, ${responseMessage || null}, ${creditsUsed}, ${now.toISOString()}
        )
        RETURNING *;
      `;
      if (inserted && inserted.length > 0) return inserted[0];
    } catch (err) {
      console.error('⚠️ DB error recordSmsHistory:', err.message);
    }
  }

  const store = getLocalStore();
  if (!Array.isArray(store.sms_history)) store.sms_history = [];
  const record = {
    id: Date.now(),
    recipient_name: recipientName || 'Unknown',
    phone: cleanPhone,
    message,
    status,
    response_message: responseMessage || null,
    credits_used: creditsUsed,
    created_at: now.toISOString()
  };
  store.sms_history.unshift(record);
  if (store.sms_history.length > 500) store.sms_history.length = 500;
  saveLocalStore(store);
  return record;
}

async function getSmsHistoryList(limit = 100) {
  const sql = getSql();
  if (isDbConnected() && sql) {
    try {
      const rows = await sql`
        SELECT * FROM sms_history 
        ORDER BY created_at DESC 
        LIMIT ${limit};
      `;
      return rows || [];
    } catch (err) {
      console.error('⚠️ DB error getSmsHistoryList:', err.message);
    }
  }

  const store = getLocalStore();
  return (store.sms_history || []).slice(0, limit);
}

// ======================== PHONE FORMATTING ========================

function formatToTextLkPhone(phone) {
  let clean = String(phone || '').replace(/\D/g, '');
  if (!clean) return '';
  if (clean.startsWith('0') && clean.length === 10) {
    clean = '94' + clean.slice(1);
  } else if (!clean.startsWith('94') && clean.length === 9) {
    clean = '94' + clean;
  }
  return clean;
}

// ======================== DISPATCH SMS VIA TEXT.LK ========================

async function sendSms({ recipientPhone, recipientName = '', message }) {
  const config = await getTextLkConfig();
  const phone = formatToTextLkPhone(recipientPhone);

  if (!phone) {
    await recordSmsHistory({
      recipientName,
      phone: recipientPhone,
      message,
      status: 'failed',
      responseMessage: 'Invalid phone number format'
    });
    return { success: false, error: 'Invalid phone number format' };
  }

  if (!config.token) {
    const errorMsg = 'Text.lk API Token is not configured in Admin Settings';
    console.warn(`⚠️ SMS to ${phone} aborted: ${errorMsg}`);
    await recordSmsHistory({
      recipientName,
      phone,
      message,
      status: 'failed',
      responseMessage: errorMsg
    });
    return { success: false, error: errorMsg };
  }

  try {
    const response = await fetch('https://app.text.lk/api/v3/sms/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        recipient: phone,
        sender_id: config.senderId || 'TextLKDemo',
        type: 'plain',
        message: message
      })
    });

    const data = await response.json().catch(() => null);

    const isSuccess = response.ok && (
      data?.status === 'success' ||
      data?.status === true ||
      data?.status === 'queued' ||
      (data && !data.error && response.status < 400)
    );

    const responseMsg = data?.message || (data ? JSON.stringify(data) : `HTTP ${response.status}`);

    if (isSuccess) {
      await incrementSmsCredits(1);
      await recordSmsHistory({
        recipientName,
        phone,
        message,
        status: 'success',
        responseMessage: responseMsg,
        creditsUsed: 1
      });
      console.log(`✅ Text.lk SMS sent to ${phone} (${recipientName})`);
      return { success: true, data };
    } else {
      const errMsg = data?.message || data?.error || `HTTP ${response.status} failed`;
      await recordSmsHistory({
        recipientName,
        phone,
        message,
        status: 'failed',
        responseMessage: errMsg
      });
      console.error(`❌ Text.lk SMS failed for ${phone}: ${errMsg}`);
      return { success: false, error: errMsg, data };
    }
  } catch (err) {
    console.error(`❌ Text.lk API call error:`, err.message);
    await recordSmsHistory({
      recipientName,
      phone,
      message,
      status: 'failed',
      responseMessage: err.message
    });
    return { success: false, error: err.message };
  }
}

// ======================== SEND BIRTHDAY SMS ========================

async function sendBirthdaySms({ contact, wishUrl }) {
  const config = await getTextLkConfig();
  const name = contact.name || '';
  const smsBody = config.template
    .replace(/\{name\}/gi, name)
    .replace(/\{link\}/gi, wishUrl);

  const phone = contact.phone || (contact.phones && contact.phones[0]) || '';
  return await sendSms({
    recipientPhone: phone,
    recipientName: name,
    message: smsBody
  });
}

module.exports = {
  getTextLkConfig,
  saveTextLkConfig,
  getSmsCreditsStats,
  incrementSmsCredits,
  recordSmsHistory,
  getSmsHistoryList,
  formatToTextLkPhone,
  sendSms,
  sendBirthdaySms
};

