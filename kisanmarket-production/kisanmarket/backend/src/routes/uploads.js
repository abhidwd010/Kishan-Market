// src/routes/uploads.js — Cloudinary signed-URL upload
const router = require('express').Router();
const cloudinary = require('cloudinary').v2;
const { requireAuth } = require('../middleware/auth');

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Frontend uploads directly to Cloudinary using this signed payload
router.post('/sign', requireAuth, (req, res) => {
  const timestamp = Math.round(Date.now() / 1000);
  const folder = `kisanmarket/${req.user.role}/${req.user.id}`;
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder, transformation: 'q_auto,f_auto,w_1600,c_limit' },
    process.env.CLOUDINARY_API_SECRET
  );
  res.json({
    timestamp, signature, folder,
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
  });
});

module.exports = router;
