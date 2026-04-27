const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";
const DB_PATH = path.join(__dirname, "data", "onboarding.db");
const TOTAL_ROWS = 73;

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS planner_profiles (
  user_id INTEGER PRIMARY KEY,
  responder_name TEXT DEFAULT '',
  responder_desig TEXT DEFAULT '',
  responder_date TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS planner_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  row_idx INTEGER NOT NULL,
  delivery_point TEXT NOT NULL CHECK(delivery_point IN ('FIP', 'Almarai', 'Field Training')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, row_idx),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

const hasUsers = db.prepare("SELECT COUNT(*) AS c FROM users").get().c > 0;
if (!hasUsers) {
  const hash = bcrypt.hashSync("Admin@123", 10);
  db.prepare(
    "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'admin', ?)"
  ).run("admin", hash, "System Administrator");
  console.log("Seeded default admin: username=admin, password=Admin@123");
}

app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 8 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Authentication required." });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  return next();
}

app.get("/", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login.html");
  }
  return res.redirect("/planner.html");
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const user = db
    .prepare("SELECT id, username, password_hash, role, display_name FROM users WHERE username = ?")
    .get(username.trim());

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid credentials." });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    displayName: user.display_name || user.username
  };

  return res.json({ user: req.session.user });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  return res.json({ user: req.session.user || null });
});

app.get("/api/planner", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const profile = db
    .prepare("SELECT responder_name, responder_desig, responder_date FROM planner_profiles WHERE user_id = ?")
    .get(userId) || { responder_name: "", responder_desig: "", responder_date: "" };

  const rows = db
    .prepare("SELECT row_idx, delivery_point FROM planner_selections WHERE user_id = ?")
    .all(userId);

  const selections = {};
  for (let i = 0; i < TOTAL_ROWS; i += 1) {
    selections[i] = null;
  }
  rows.forEach((r) => {
    selections[r.row_idx] = r.delivery_point;
  });

  return res.json({
    profile: {
      name: profile.responder_name || "",
      desig: profile.responder_desig || "",
      date: profile.responder_date || ""
    },
    selections
  });
});

app.put("/api/planner", requireAuth, (req, res) => {
  const userId = req.session.user.id;
  const profile = req.body?.profile || {};
  const selections = req.body?.selections || {};

  const upsertProfile = db.prepare(`
    INSERT INTO planner_profiles (user_id, responder_name, responder_desig, responder_date, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      responder_name=excluded.responder_name,
      responder_desig=excluded.responder_desig,
      responder_date=excluded.responder_date,
      updated_at=CURRENT_TIMESTAMP
  `);
  const deleteSelections = db.prepare("DELETE FROM planner_selections WHERE user_id = ?");
  const insertSelection = db.prepare(`
    INSERT INTO planner_selections (user_id, row_idx, delivery_point, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const tx = db.transaction(() => {
    upsertProfile.run(
      userId,
      String(profile.name || ""),
      String(profile.desig || ""),
      String(profile.date || "")
    );
    deleteSelections.run(userId);
    Object.entries(selections).forEach(([idx, val]) => {
      if (val === "FIP" || val === "Almarai" || val === "Field Training") {
        insertSelection.run(userId, Number(idx), val);
      }
    });
  });
  tx();

  return res.json({ ok: true });
});

app.get("/api/report", requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, username, role, display_name FROM users ORDER BY id").all();

  const report = users.map((u) => {
    const profile =
      db
        .prepare("SELECT responder_name, responder_desig, responder_date FROM planner_profiles WHERE user_id = ?")
        .get(u.id) || {};
    const rows = db
      .prepare("SELECT row_idx, delivery_point FROM planner_selections WHERE user_id = ?")
      .all(u.id);
    return {
      user: {
        id: u.id,
        username: u.username,
        role: u.role,
        displayName: u.display_name || u.username
      },
      profile: {
        name: profile.responder_name || "",
        desig: profile.responder_desig || "",
        date: profile.responder_date || ""
      },
      selections: rows
    };
  });

  return res.json({ report });
});

app.post("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  const { username, password, role, displayName } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: "username, password, role are required." });
  }
  if (!["admin", "user"].includes(role)) {
    return res.status(400).json({ error: "role must be admin or user." });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db
      .prepare("INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)")
      .run(username.trim(), hash, role, displayName || username.trim());
    return res.status(201).json({ id: info.lastInsertRowid });
  } catch (error) {
    return res.status(409).json({ error: "User already exists." });
  }
});

app.listen(PORT, () => {
  console.log(`Onboarding app listening on port ${PORT}`);
});
