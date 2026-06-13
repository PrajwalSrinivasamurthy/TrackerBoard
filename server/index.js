import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || __dirname;
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "data.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

const app = express();
app.use(express.json({ limit: "25mb" }));

app.get(["/api/kv/:key", "/trackerboard/api/kv/:key"], (req, res) => {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(req.params.key);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json({ value: row.value });
});

app.put(["/api/kv/:key", "/trackerboard/api/kv/:key"], (req, res) => {
  const { value } = req.body;
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(req.params.key, value);
  res.json({ ok: true });
});

app.delete(["/api/kv/:key", "/trackerboard/api/kv/:key"], (req, res) => {
  db.prepare("DELETE FROM kv WHERE key = ?").run(req.params.key);
  res.json({ ok: true });
});

// serve the built frontend (npm run build in the project root) in production
const distDir = path.join(__dirname, "..", "dist");
app.use('/trackerboard', express.static(distDir));
app.get('/trackerboard', (req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});
app.get('/trackerboard/*', (req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`TTUO server listening on http://localhost:${PORT}`));
