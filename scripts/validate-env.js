import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envPath = path.resolve(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  console.error("Missing .env file. Copy .env.example to .env first.");
  process.exit(1);
}

dotenv.config({ path: envPath });

const required = [
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "DATABASE_URL",
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "TWITCH_EVENTSUB_SECRET",
  "PUBLIC_BASE_URL"
];

const missing = required.filter((name) => !process.env[name] || process.env[name].trim() === "");
if (missing.length > 0) {
  console.error("Missing required values in .env:");
  for (const name of missing) {
    console.error(`- ${name}`);
  }
  process.exit(1);
}

const issues = [];
if (!/^https:\/\//.test(process.env.PUBLIC_BASE_URL)) {
  issues.push("PUBLIC_BASE_URL must start with https://");
}

const refreshSeconds = Number.parseInt(process.env.REFRESH_INTERVAL_SECONDS ?? "90", 10);
if (Number.isNaN(refreshSeconds) || refreshSeconds <= 0) {
  issues.push("REFRESH_INTERVAL_SECONDS must be a positive integer");
}

if ((process.env.TWITCH_EVENTSUB_SECRET ?? "").length < 12) {
  issues.push("TWITCH_EVENTSUB_SECRET should be at least 12 characters long");
}

if (issues.length > 0) {
  console.error("Configuration issues found:");
  for (const issue of issues) {
    console.error(`- ${issue}`);
  }
  process.exit(1);
}

console.log("Environment looks valid.");
