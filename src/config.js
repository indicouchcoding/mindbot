import dotenv from "dotenv";

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return value;
}

export const config = {
  discordToken: requireEnv("DISCORD_TOKEN"),
  discordClientId: requireEnv("DISCORD_CLIENT_ID"),
  discordGuildId: requireEnv("DISCORD_GUILD_ID"),
  databaseUrl: requireEnv("DATABASE_URL"),
  twitchClientId: requireEnv("TWITCH_CLIENT_ID"),
  twitchClientSecret: requireEnv("TWITCH_CLIENT_SECRET"),
  twitchEventsubSecret: requireEnv("TWITCH_EVENTSUB_SECRET"),
  publicBaseUrl: requireEnv("PUBLIC_BASE_URL").replace(/\/$/, ""),
  port: parseInteger("PORT", 3000),
  refreshIntervalSeconds: parseInteger("REFRESH_INTERVAL_SECONDS", 90),
  defaultAlertEveryone: String(process.env.DEFAULT_ALERT_EVERYONE ?? "true").toLowerCase() === "true"
};
