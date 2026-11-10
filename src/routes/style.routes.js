const path = require('path');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const styleController = require('../controllers/style.controller');
const { PATHS } = require('../config/env.config');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(PATHS.ASSETS_DIR, 'img'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `frame_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

router.get('/api/user-style', styleController.getStyles);
router.post('/api/user-style', styleController.updateStyle);
router.post('/api/user-style/select', styleController.updateStyle);
router.post('/api/user-style/coordinates', styleController.updateCoordinates);
router.post('/api/user-style/upload', upload.single('frame'), styleController.uploadFrameStyle);
router.delete('/api/user-style/:id', styleController.deleteFrameStyle);

module.exports = router;
