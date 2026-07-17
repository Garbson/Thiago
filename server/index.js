require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const { initDatabase } = require("./db");
const { authRouter } = require("./routes/auth");
const propertiesRouter = require("./routes/properties");
const portalsRouter = require("./routes/portals");
const leadsRouter = require("./routes/leads");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(path.join(__dirname, "..")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// API routes
app.use("/api/auth", authRouter);
app.use("/api/properties", propertiesRouter);
app.use("/api/portals", portalsRouter);
app.use("/api/leads", leadsRouter);

// Serve admin page
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "admin.html"));
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

async function start() {
  try {
    await initDatabase();
    console.log("Database initialized");

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Admin panel: http://localhost:${PORT}/admin`);
    });
  } catch (err) {
    console.error("Failed to start:", err.message);
    process.exit(1);
  }
}

start();
