const fs = require('fs');
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { PATHS } = require('../config/env.config');
const { safeReadJson, safeWriteJson } = require('../utils/file.util');

const WA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://web.whatsapp.com/',
  Accept: 'image/*'
};

const { getDbFrameStyles, saveDbFrameStyles } = require('./db.service');

let cachedStyles = null;
let currentStyleId = '1';

async function initStylesAsync() {
  try {
    const data = await getDbFrameStyles();
    if (data && data.frameStyles) {
      cachedStyles = data;
      currentStyleId = data.user_selected_style || Object.keys(data.frameStyles)[0] || '1';
      console.log('✅ Frame styles loaded from DB/Storage. Selected style:', currentStyleId);
    }
  } catch (err) {
    console.warn('⚠️ initStylesAsync warning:', err.message);
  }
}

// Initial synchronous fallback
function initStyles() {
  const data = safeReadJson(PATHS.FRAME_STYLES, null);
  if (data && data.frameStyles) {
    cachedStyles = data;
    currentStyleId = data.user_selected_style || Object.keys(data.frameStyles)[0] || '1';
  } else {
    cachedStyles = { frameStyles: {} };
  }
}
initStyles();
setTimeout(initStylesAsync, 1000);

function getStylesData() {
  if (!cachedStyles) initStyles();
  return cachedStyles;
}

async function getStylesDataAsync() {
  const data = await getDbFrameStyles();
  if (data && data.frameStyles) {
    cachedStyles = data;
    currentStyleId = data.user_selected_style || currentStyleId || '1';
  }
  return cachedStyles;
}

function getSelectedStyleId() {
  return currentStyleId;
}

async function setSelectedStyleId(styleId) {
  currentStyleId = String(styleId);
  const data = await getDbFrameStyles();
  data.user_selected_style = currentStyleId;
  await saveDbFrameStyles(data);
  cachedStyles = data;
  return currentStyleId;
}

async function updateStyleCoordinates(styleId, textConfig, profileConfig) {
  const data = await getDbFrameStyles();
  if (!data.frameStyles) data.frameStyles = {};

  const sid = String(styleId);
  if (!data.frameStyles[sid]) {
    throw new Error(`Frame style "${sid}" not found`);
  }

  if (textConfig && typeof textConfig === 'object') {
    data.frameStyles[sid].text = {
      ...(data.frameStyles[sid].text || {}),
      ...textConfig
    };
  }

  if (profileConfig && typeof profileConfig === 'object') {
    data.frameStyles[sid].profile = {
      ...(data.frameStyles[sid].profile || {}),
      ...profileConfig
    };
  }

  await saveDbFrameStyles(data);
  cachedStyles = data;
  console.log(`✅ Frame style "${sid}" coordinates updated and saved to Database`);
  return data.frameStyles[sid];
}

async function addNewStyle({ styleId, framePath, text, profile }) {
  const data = await getDbFrameStyles();
  if (!data.frameStyles) data.frameStyles = {};

  const sid = String(styleId || `style_${Date.now()}`);
  data.frameStyles[sid] = {
    framePath,
    profile: profile || { width: 500, height: 500, left: 250, top: 300, rotation: 0 },
    text: text || {
      x: '50%',
      y: '1000',
      fontSize: '45',
      color: '#000000',
      fontFamily: 'sans-serif'
    }
  };

  await saveDbFrameStyles(data);
  cachedStyles = data;
  return { styleId: sid, style: data.frameStyles[sid] };
}

async function deleteStyle(styleId) {
  const data = await getDbFrameStyles();
  const sid = String(styleId);
  if (data.frameStyles && data.frameStyles[sid]) {
    delete data.frameStyles[sid];
    if (data.user_selected_style === sid) {
      data.user_selected_style = Object.keys(data.frameStyles)[0] || '1';
      currentStyleId = data.user_selected_style;
    }
    await saveDbFrameStyles(data);
    cachedStyles = data;
    return true;
  }
  return false;
}

/**
 * Downloads contact profile picture and returns 300x300 PNG buffer.
 * If not available or fails, falls back to default avatar PNG buffer.
 */
async function fetchProfilePicBuffer(profilePicUrl, contactName, maxRetries = 3, retryDelay = 2000) {
  const defaultAvatarPath = path.join(PATHS.ASSETS_DIR, 'img', 'default_avatar.png');

  if (profilePicUrl && typeof profilePicUrl === 'string' && profilePicUrl.startsWith('http')) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'image/*'
    };
    if (profilePicUrl.includes('whatsapp.net')) {
      headers['Referer'] = 'https://web.whatsapp.com/';
    }

    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const res = await axios.get(profilePicUrl, {
          responseType: 'arraybuffer',
          headers,
          timeout: 8000
        });

        if (res.status === 200 && res.headers['content-type']?.startsWith('image/')) {
          const buffer = await sharp(res.data)
            .resize(300, 300, { fit: 'cover' })
            .ensureAlpha()
            .png()
            .toBuffer();

          console.log(`✅ Profile picture fetched for ${contactName} (attempt ${attempt + 1})`);
          return buffer;
        }
      } catch (err) {
        attempt++;
        console.warn(`⚠️ Attempt ${attempt} failed fetching profile pic for ${contactName}:`, err.message);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, retryDelay));
        }
      }
    }
  }

  // Graceful Fallback: Always return default avatar buffer so framed card is ALWAYS generated
  if (fs.existsSync(defaultAvatarPath)) {
    try {
      console.log(`ℹ️ Using default avatar for framed card: ${contactName}`);
      return await sharp(defaultAvatarPath)
        .resize(300, 300, { fit: 'cover' })
        .ensureAlpha()
        .png()
        .toBuffer();
    } catch (e) {
      console.warn('⚠️ Could not load default avatar:', e.message);
    }
  }

  return null;
}

/**
 * Loads font buffer safely (local fallback supported).
 */
async function getFontBase64(fontUrl) {
  const localDefaultFont = path.join(PATHS.ASSETS_DIR, 'fonts', 'MagnoliaScript.otf');

  // Try downloading from URL if provided and not a GitHub blob webpage
  if (fontUrl && typeof fontUrl === 'string' && fontUrl.startsWith('http')) {
    // If it's a github blob URL, convert to raw.githubusercontent.com
    const rawUrl = fontUrl
      .replace('github.com/', 'raw.githubusercontent.com/')
      .replace('/blob/', '/');

    try {
      const res = await axios.get(rawUrl, {
        responseType: 'arraybuffer',
        timeout: 5000
      });
      // Ensure it's not HTML
      const head = Buffer.from(res.data.slice(0, 10)).toString('utf8');
      if (!head.includes('<!DOCTYPE') && !head.includes('<html')) {
        return Buffer.from(res.data).toString('base64');
      }
    } catch {
      // Fall through to local font
    }
  }

  // Fallback to local font file
  if (fs.existsSync(localDefaultFont)) {
    return fs.readFileSync(localDefaultFont).toString('base64');
  }

  return null;
}

/**
 * Creates a framed image compositing profile picture, frame overlay, and styled text.
 */
async function createFramedImage(profileBuffer, contactName, styleKey = null) {
  if (!profileBuffer) return null;

  const styles = getStylesData();
  const selectedKey = styleKey || currentStyleId || styles.user_selected_style || '1';
  const style = styles.frameStyles?.[selectedKey];

  if (!style) return profileBuffer;

  const framePath = path.isAbsolute(style.framePath)
    ? style.framePath
    : path.join(PATHS.ROOT_DIR, style.framePath);

  if (!fs.existsSync(framePath)) {
    console.warn(`⚠️ Frame path not found: ${framePath}`);
    return profileBuffer;
  }

  try {
    const fontBase64 = await getFontBase64(style.text?.fonturl);

    const profileResized = await sharp(profileBuffer)
      .resize(style.profile.width, style.profile.height, { fit: 'cover' })
      .toBuffer();

    const frameMeta = await sharp(framePath).metadata();
    const contactUpper = (contactName || '').toUpperCase();

    const fontFaceCss = fontBase64
      ? `@font-face {
           font-family: '${style.text?.fontFamily || 'CustomFont'}';
           src: url(data:font/ttf;base64,${fontBase64}) format('truetype');
         }`
      : '';

    let transformAttr = '';
    if (style.text?.transform) {
      transformAttr = `transform="${style.text.transform}"`;
    } else if (style.text?.rotation) {
      const rx = style.text?.x || '50%';
      const ry = style.text?.y || '50%';
      transformAttr = `transform="rotate(${style.text.rotation}, ${rx}, ${ry})"`;
    }

    const svgText = `
      <svg width="${frameMeta.width}" height="${frameMeta.height}">
        <style>
          ${fontFaceCss}
          .title {
            fill: ${style.text?.color || '#000000'};
            font-family: ${style.text?.fontFamily || 'sans-serif'};
            font-size: ${style.text?.fontSize || 45}px;
            font-weight: bold;
            text-anchor: middle;
            dominant-baseline: middle;
          }
        </style>
        <text x="${style.text?.x || '50%'}" y="${style.text?.y || '50%'}" ${transformAttr} class="title">
          ${contactUpper}
        </text>
      </svg>
    `;

    const finalImage = await sharp({
      create: {
        width: frameMeta.width,
        height: frameMeta.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite([
        { input: profileResized, top: style.profile.top, left: style.profile.left },
        { input: framePath, top: 0, left: 0 },
        { input: Buffer.from(svgText), top: 0, left: 0 }
      ])
      .png()
      .toBuffer();

    return finalImage;
  } catch (err) {
    console.error(`❌ Error creating framed image for ${contactName}:`, err.message || err);
    return profileBuffer;
  }
}

module.exports = {
  getStylesData,
  getStylesDataAsync,
  getSelectedStyleId,
  setSelectedStyleId,
  updateStyleCoordinates,
  addNewStyle,
  deleteStyle,
  fetchProfilePicBuffer,
  createFramedImage
};

