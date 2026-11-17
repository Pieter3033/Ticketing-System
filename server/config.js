const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function parseSqlPageDatabaseUrl(databaseUrl) {
  const raw = String(databaseUrl || "").trim();
  const match = raw.match(/^mssql:\/\/([^:]+):(.+)@([^/:]+)(?::(\d+))?\/(.+)$/);
  if (!match) {
    throw new Error("Unsupported SQLPage database_url format. Set INTERNAL_TICKETS_DB_* environment variables instead.");
  }
  return {
    user: decodeURIComponent(match[1]),
    password: decodeURIComponent(match[2]),
    server: match[3],
    port: parseInteger(match[4], 1433),
    database: decodeURIComponent(match[5])
  };
}

function readSqlPageDbConfig() {
  const configPath = process.env.SQLPAGE_CONFIG_PATH
    ? path.resolve(process.env.SQLPAGE_CONFIG_PATH)
    : path.resolve(__dirname, "..", "..", "sqlpage", "sqlpage.json");
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw);
  return parseSqlPageDatabaseUrl(parsed.database_url);
}

function dbConfig() {
  if (process.env.INTERNAL_TICKETS_DB_SERVER) {
    return {
      server: process.env.INTERNAL_TICKETS_DB_SERVER,
      port: parseInteger(process.env.INTERNAL_TICKETS_DB_PORT, 1433),
      user: process.env.INTERNAL_TICKETS_DB_USER,
      password: process.env.INTERNAL_TICKETS_DB_PASSWORD,
      database: process.env.INTERNAL_TICKETS_DB_DATABASE || "Jobcard"
    };
  }
  return readSqlPageDbConfig();
}

const uploadRoot = path.resolve(
  process.env.INTERNAL_TICKETS_ATTACHMENT_DIR || "E:\\SQLPage\\sqlpage\\internaltickets_attachments"
);

module.exports = {
  port: parseInteger(process.env.INTERNAL_TICKETS_PORT || process.env.PORT, 3200),
  db: {
    ...dbConfig(),
    options: {
      encrypt: parseBoolean(process.env.INTERNAL_TICKETS_DB_ENCRYPT, false),
      trustServerCertificate: parseBoolean(process.env.INTERNAL_TICKETS_DB_TRUST_SERVER_CERT, true)
    }
  },
  corsOrigins: (process.env.INTERNAL_TICKETS_CORS_ORIGINS || "http://127.0.0.1:8080,http://localhost:8080,https://job.pulsit.co.za")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  uploads: {
    root: uploadRoot,
    maxBytes: parseInteger(process.env.INTERNAL_TICKETS_MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
    allowedExtensions: new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp", "pdf", "txt", "doc", "docx", "xls", "xlsx", "csv", "mp3", "mp4", "wav", "avi", "mov"])
  }
};
