// src/routes/crops.js — read-only crop catalog
const router = require('express').Router();
const db = require('../utils/db');

router.get('/', async (req, res, next) => {
  try {
    const { category, q } = req.query;
    const params = []; const where = ['active = TRUE'];
    if (category) { params.push(category); where.push(`category = $${params.length}`); }
    if (q) { params.push(`%${q}%`); where.push(`(name ILIKE $${params.length} OR hindi_name ILIKE $${params.length})`); }
    const r = await db.query(`
      SELECT id, category, sub_category, name, hindi_name, default_units, ref_price_min, ref_price_max
        FROM crops WHERE ${where.join(' AND ')} ORDER BY category, name`, params);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

router.get('/categories', async (_req, res, next) => {
  try {
    const r = await db.query(`
      SELECT category, COUNT(*)::int AS crop_count FROM crops WHERE active = TRUE
      GROUP BY category ORDER BY category`);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
