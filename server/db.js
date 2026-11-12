const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "chiaradia_carneiro",
  waitForConnections: true,
  connectionLimit: 10,
});

async function initDatabase() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
  });

  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME || "chiaradia_carneiro"}\``
  );
  await conn.end();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      price DECIMAL(15,2),
      property_type ENUM('apartamento','casa','terreno','comercial','cobertura','studio','rural','galpao') DEFAULT 'apartamento',
      transaction_type ENUM('venda','aluguel','venda_aluguel') DEFAULT 'venda',
      address VARCHAR(500),
      neighborhood VARCHAR(255),
      city VARCHAR(255),
      state VARCHAR(2) DEFAULT 'SC',
      zip_code VARCHAR(10),
      area DECIMAL(10,2),
      bedrooms INT DEFAULT 0,
      bathrooms INT DEFAULT 0,
      parking INT DEFAULT 0,
      suites INT DEFAULT 0,
      furnished TINYINT(1) DEFAULT 0,
      condominium_fee DECIMAL(10,2) DEFAULT 0,
      iptu DECIMAL(10,2) DEFAULT 0,
      tag VARCHAR(50),
      featured TINYINT(1) DEFAULT 0,
      active TINYINT(1) DEFAULT 1,
      published_olx TINYINT(1) DEFAULT 0,
      published_zapimoveis TINYINT(1) DEFAULT 0,
      published_chavenasmao TINYINT(1) DEFAULT 0,
      published_vivareal TINYINT(1) DEFAULT 0,
      published_imovelweb TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS property_images (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      filename VARCHAR(500) NOT NULL,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      portal VARCHAR(100) NOT NULL,
      action VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL,
      response TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      email VARCHAR(255),
      source ENUM('whatsapp','site','indicacao','portal','telefone','instagram','outro') DEFAULT 'outro',
      status ENUM('novo','em_contato','visitou','negociando','fechado','perdido') DEFAULT 'novo',
      property_interest VARCHAR(500),
      property_id INT,
      budget_min DECIMAL(15,2),
      budget_max DECIMAL(15,2),
      notes TEXT,
      assigned_to VARCHAR(255),
      next_followup DATE,
      lost_reason VARCHAR(500),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE SET NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_activities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      lead_id INT NOT NULL,
      type ENUM('nota','ligacao','whatsapp','email','visita','proposta','outro') DEFAULT 'nota',
      description TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    )
  `);

  // Usuários iniciais vêm do .env: ADMIN_EMAIL/ADMIN_PASSWORD e, opcionalmente,
  // ADMIN_EMAIL_2/ADMIN_PASSWORD_2. Só cria quem ainda não existe.
  const bcrypt = require("bcryptjs");
  const seeds = [
    [process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, "Administrador"],
    [process.env.ADMIN_EMAIL_2, process.env.ADMIN_PASSWORD_2, "Administrador 2"],
  ].filter(([email]) => email);

  const [existing] = await pool.query("SELECT id FROM users LIMIT 1");
  if (existing.length === 0 && seeds.length === 0) {
    throw new Error("Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env para criar o primeiro usuário");
  }
  for (const [email, password, name] of seeds) {
    const [found] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (found.length) continue;
    if (!password || password.length < 10) {
      throw new Error(`Senha de ${email} precisa ter 10+ caracteres no .env`);
    }
    await pool.query("INSERT INTO users (email, password, name) VALUES (?, ?, ?)", [
      email,
      await bcrypt.hash(password, 12),
      name,
    ]);
    console.log(`Usuário criado: ${email}`);
  }
}

module.exports = { pool, initDatabase };
