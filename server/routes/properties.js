const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { pool } = require("../db");
const { authMiddleware } = require("./auth");

const router = express.Router();

const storage = multer.diskStorage({
  destination: path.join(__dirname, "../uploads"),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  },
});

// Public: list active properties for landing page
router.get("/public", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*,
        (SELECT pi.filename FROM property_images pi WHERE pi.property_id = p.id ORDER BY pi.sort_order LIMIT 1) as image
       FROM properties p
       WHERE p.active = 1
       ORDER BY p.featured DESC, p.created_at DESC
       LIMIT 10`
    );

    for (const row of rows) {
      const [images] = await pool.query(
        "SELECT filename FROM property_images WHERE property_id = ? ORDER BY sort_order",
        [row.id]
      );
      row.images = images.map((img) => `/uploads/${img.filename}`);
      if (row.image) row.image = `/uploads/${row.image}`;
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar imóveis" });
  }
});

// Admin: list all properties
router.get("/", authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM properties ORDER BY created_at DESC"
    );

    for (const row of rows) {
      const [images] = await pool.query(
        "SELECT id, filename, sort_order FROM property_images WHERE property_id = ? ORDER BY sort_order",
        [row.id]
      );
      row.images = images.map((img) => ({
        id: img.id,
        url: `/uploads/${img.filename}`,
        sort_order: img.sort_order,
      }));
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro ao buscar imóveis" });
  }
});

// Admin: create property
router.post("/", authMiddleware, upload.array("images", 20), async (req, res) => {
  try {
    const maxProps = parseInt(process.env.MAX_PROPERTIES) || 10;
    const [count] = await pool.query("SELECT COUNT(*) as total FROM properties");
    if (count[0].total >= maxProps) {
      if (req.files) req.files.forEach((f) => fs.unlinkSync(f.path));
      return res.status(400).json({
        error: `Limite de ${maxProps} imóveis atingido. Remova um imóvel antes de adicionar outro.`,
      });
    }

    const {
      title, description, price, property_type, transaction_type,
      address, neighborhood, city, state, zip_code,
      area, bedrooms, bathrooms, parking, suites,
      furnished, condominium_fee, iptu, tag, featured,
    } = req.body;

    const [result] = await pool.query(
      `INSERT INTO properties
        (title, description, price, property_type, transaction_type,
         address, neighborhood, city, state, zip_code,
         area, bedrooms, bathrooms, parking, suites,
         furnished, condominium_fee, iptu, tag, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title, description, price || 0, property_type || "apartamento",
        transaction_type || "venda", address, neighborhood, city,
        state || "SP", zip_code, area || 0, bedrooms || 0,
        bathrooms || 0, parking || 0, suites || 0,
        furnished ? 1 : 0, condominium_fee || 0, iptu || 0,
        tag, featured ? 1 : 0,
      ]
    );

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        await pool.query(
          "INSERT INTO property_images (property_id, filename, sort_order) VALUES (?, ?, ?)",
          [result.insertId, req.files[i].filename, i]
        );
      }
    }

    const [property] = await pool.query("SELECT * FROM properties WHERE id = ?", [result.insertId]);
    res.status(201).json(property[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar imóvel" });
  }
});

// Admin: update property
router.put("/:id", authMiddleware, upload.array("images", 20), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, price, property_type, transaction_type,
      address, neighborhood, city, state, zip_code,
      area, bedrooms, bathrooms, parking, suites,
      furnished, condominium_fee, iptu, tag, featured, active,
    } = req.body;

    await pool.query(
      `UPDATE properties SET
        title=?, description=?, price=?, property_type=?, transaction_type=?,
        address=?, neighborhood=?, city=?, state=?, zip_code=?,
        area=?, bedrooms=?, bathrooms=?, parking=?, suites=?,
        furnished=?, condominium_fee=?, iptu=?, tag=?, featured=?, active=?
       WHERE id=?`,
      [
        title, description, price || 0, property_type || "apartamento",
        transaction_type || "venda", address, neighborhood, city,
        state || "SP", zip_code, area || 0, bedrooms || 0,
        bathrooms || 0, parking || 0, suites || 0,
        furnished ? 1 : 0, condominium_fee || 0, iptu || 0,
        tag, featured ? 1 : 0, active !== undefined ? (active ? 1 : 0) : 1,
        id,
      ]
    );

    if (req.files && req.files.length > 0) {
      const [maxOrder] = await pool.query(
        "SELECT COALESCE(MAX(sort_order), -1) as max_order FROM property_images WHERE property_id = ?",
        [id]
      );
      let order = maxOrder[0].max_order + 1;
      for (const file of req.files) {
        await pool.query(
          "INSERT INTO property_images (property_id, filename, sort_order) VALUES (?, ?, ?)",
          [id, file.filename, order++]
        );
      }
    }

    const [property] = await pool.query("SELECT * FROM properties WHERE id = ?", [id]);
    const [images] = await pool.query(
      "SELECT id, filename, sort_order FROM property_images WHERE property_id = ? ORDER BY sort_order",
      [id]
    );
    property[0].images = images.map((img) => ({
      id: img.id,
      url: `/uploads/${img.filename}`,
      sort_order: img.sort_order,
    }));

    res.json(property[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar imóvel" });
  }
});

// Admin: delete property
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const [images] = await pool.query(
      "SELECT filename FROM property_images WHERE property_id = ?",
      [id]
    );
    for (const img of images) {
      const filePath = path.join(__dirname, "../uploads", img.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    await pool.query("DELETE FROM properties WHERE id = ?", [id]);
    res.json({ message: "Imóvel removido" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao remover imóvel" });
  }
});

// Admin: delete specific image
router.delete("/images/:imageId", authMiddleware, async (req, res) => {
  try {
    const { imageId } = req.params;
    const [imgs] = await pool.query("SELECT filename FROM property_images WHERE id = ?", [imageId]);
    if (imgs.length > 0) {
      const filePath = path.join(__dirname, "../uploads", imgs[0].filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await pool.query("DELETE FROM property_images WHERE id = ?", [imageId]);
    }
    res.json({ message: "Imagem removida" });
  } catch (err) {
    res.status(500).json({ error: "Erro ao remover imagem" });
  }
});

module.exports = router;
