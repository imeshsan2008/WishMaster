const path = require('path');
const sharp = require('sharp');
const {
  getStylesDataAsync,
  setSelectedStyleId,
  updateStyleCoordinates,
  addNewStyle,
  deleteStyle
} = require('../services/image.service');

async function getStyles(req, res) {
  try {
    const data = await getStylesDataAsync();
    res.json(data);
  } catch (err) {
    console.error('❌ Error getting styles:', err.message);
    res.status(500).json({ error: 'Failed to load styles' });
  }
}

async function updateStyle(req, res) {
  try {
    const { user_selected_style } = req.body;
    if (!user_selected_style) {
      return res.status(400).json({ error: 'Missing style id' });
    }
    const updated = await setSelectedStyleId(user_selected_style);
    res.json({ success: true, user_selected_style: updated });
  } catch (err) {
    console.error('❌ Error updating style:', err.message);
    res.status(500).json({ error: 'Failed to save style' });
  }
}

async function updateCoordinates(req, res) {
  try {
    const { styleId, text, profile } = req.body;
    if (!styleId) {
      return res.status(400).json({ error: 'Missing styleId' });
    }
    const updatedStyle = await updateStyleCoordinates(styleId, text, profile);
    res.json({ success: true, styleId, style: updatedStyle });
  } catch (err) {
    console.error('❌ Error updating coordinates:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update coordinates' });
  }
}

async function uploadFrameStyle(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No frame image file uploaded' });
    }
    const filename = req.file.filename;
    const relPath = `assets/img/${filename}`;
    const fullPath = req.file.path;

    // Get image dimensions using sharp
    const meta = await sharp(fullPath).metadata();
    const width = meta.width || 1080;
    const height = meta.height || 1080;

    // Default positioning: name centered towards bottom, profile centered towards middle
    const styleId = `style_${Date.now()}`;
    const defaultText = {
      x: String(Math.round(width / 2)),
      y: String(Math.round(height * 0.8)),
      fontSize: String(Math.round(width * 0.045)),
      color: '#000000',
      fontFamily: 'sans-serif'
    };
    const defaultProfile = {
      width: Math.round(width * 0.4),
      height: Math.round(width * 0.4),
      left: Math.round(width * 0.3),
      top: Math.round(height * 0.25)
    };

    const newStyle = await addNewStyle({
      styleId,
      framePath: relPath,
      text: defaultText,
      profile: defaultProfile
    });

    res.json({
      success: true,
      styleId,
      style: newStyle.style,
      message: 'Frame template uploaded and added successfully'
    });
  } catch (err) {
    console.error('❌ Error uploading frame style:', err.message);
    res.status(500).json({ error: err.message || 'Failed to upload frame' });
  }
}

async function deleteFrameStyle(req, res) {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Missing style id' });
    }
    const deleted = await deleteStyle(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Style not found' });
    }
    res.json({ success: true, message: `Frame template ${id} deleted` });
  } catch (err) {
    console.error('❌ Error deleting frame style:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete frame style' });
  }
}

module.exports = {
  getStyles,
  updateStyle,
  updateCoordinates,
  uploadFrameStyle,
  deleteFrameStyle
};
