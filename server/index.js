require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

// Sem estes valores o servidor subiria com segredos previsíveis.
for (const key of ["JWT_SECRET", "DB_PASSWORD"]) {
  if (!process.env[key]) {
    console.error(`Variável ${key} não definida. Copie .env.example para .env e preencha.`);
    process.exit(1);
  }
}
if (process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET precisa ter pelo menos 32 caracteres.");
  process.exit(1);
}

const { initDatabase } = require("./db");
const { authRouter } = require("./routes/auth");
const propertiesRouter = require("./routes/properties");
const portalsRouter = require("./routes/portals");
const leadsRouter = require("./routes/leads");

const app = express();
const PORT = process.env.PORT || 3001;
const ROOT = path.join(__dirname, "..");

// Atrás do nginx: req.protocol e req.ip vêm dos cabeçalhos do proxy.
app.set("trust proxy", 1);
app.disable("x-powered-by");

if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(",").map((o) => o.trim()) }));
}
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Só o que é público sai do disco: nada de servir a raiz do repositório.
app.use("/assets", express.static(path.join(ROOT, "assets"), { maxAge: "7d" }));
app.use(
  "/uploads",
  express.static(process.env.UPLOADS_DIR || path.join(__dirname, "uploads"), {
    maxAge: "30d",
  })
);

app.use("/api/auth", authRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/portals", portalsRouter);
app.use("/api/leads", leadsRouter);
app.use("/api", (req, res) => res.status(404).json({ error: "Rota não encontrada" }));

app.get(["/admin", "/admin.html"], (req, res) => {
  res.sendFile(path.join(ROOT, "admin.html"));
});

app.get("*", (req, res) => {
  res.sendFile(path.join(ROOT, "index.html"));
});

async function start() {
  try {
    await initDatabase();
    console.log("Database initialized");

    app.listen(PORT, process.env.HOST || "127.0.0.1", () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start:", err.message);
    process.exit(1);
  }
}

start();
