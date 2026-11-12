const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authMiddleware } = require("./auth");

router.use(authMiddleware);

router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT l.*, p.title as property_title
      FROM leads l
      LEFT JOIN properties p ON l.property_id = p.id
      ORDER BY l.updated_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const [total] = await pool.query("SELECT COUNT(*) as count FROM leads");
    const [byStatus] = await pool.query("SELECT status, COUNT(*) as count FROM leads GROUP BY status");
    const [thisMonth] = await pool.query(
      "SELECT COUNT(*) as count FROM leads WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())"
    );
    const [followups] = await pool.query(
      "SELECT COUNT(*) as count FROM leads WHERE next_followup <= CURDATE() AND status NOT IN ('fechado','perdido')"
    );
    res.json({
      total: total[0].count,
      thisMonth: thisMonth[0].count,
      pendingFollowups: followups[0].count,
      byStatus: byStatus.reduce((acc, r) => { acc[r.status] = r.count; return acc; }, {}),
    });
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT l.*, p.title as property_title FROM leads l LEFT JOIN properties p ON l.property_id = p.id WHERE l.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Lead não encontrado" });
    const [activities] = await pool.query(
      "SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json({ ...rows[0], activities });
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, phone, email, source, status, property_interest, property_id, budget_min, budget_max, notes, assigned_to, next_followup } = req.body;
    if (!name) return res.status(400).json({ error: "Nome é obrigatório" });
    const [result] = await pool.query(
      `INSERT INTO leads (name, phone, email, source, status, property_interest, property_id, budget_min, budget_max, notes, assigned_to, next_followup)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, phone || null, email || null, source || "outro", status || "novo", property_interest || null, property_id || null, budget_min || null, budget_max || null, notes || null, assigned_to || null, next_followup || null]
    );
    res.status(201).json({ id: result.insertId, message: "Lead criado" });
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { name, phone, email, source, status, property_interest, property_id, budget_min, budget_max, notes, assigned_to, next_followup, lost_reason } = req.body;
    await pool.query(
      `UPDATE leads SET name=?, phone=?, email=?, source=?, status=?, property_interest=?, property_id=?, budget_min=?, budget_max=?, notes=?, assigned_to=?, next_followup=?, lost_reason=? WHERE id=?`,
      [name, phone || null, email || null, source || "outro", status || "novo", property_interest || null, property_id || null, budget_min || null, budget_max || null, notes || null, assigned_to || null, next_followup || null, lost_reason || null, req.params.id]
    );
    res.json({ message: "Lead atualizado" });
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM leads WHERE id = ?", [req.params.id]);
    res.json({ message: "Lead excluído" });
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

router.post("/:id/activities", async (req, res) => {
  try {
    const { type, description } = req.body;
    if (!description) return res.status(400).json({ error: "Descrição é obrigatória" });
    const [result] = await pool.query(
      "INSERT INTO lead_activities (lead_id, type, description) VALUES (?, ?, ?)",
      [req.params.id, type || "nota", description]
    );
    res.status(201).json({ id: result.insertId, message: "Atividade registrada" });
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
