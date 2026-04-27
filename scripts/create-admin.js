const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error("Usage: node scripts/create-admin.js <username> <password>");
  process.exit(1);
}

const db = new Database(path.join(__dirname, "..", "data", "onboarding.db"));
const hash = bcrypt.hashSync(password, 10);

try {
  db.prepare(
    "INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, 'admin', ?)"
  ).run(username, hash, username);
  console.log(`Admin user created: ${username}`);
} catch (error) {
  console.error("Failed to create admin user:", error.message);
  process.exit(1);
}
