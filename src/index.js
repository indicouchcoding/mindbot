import { config } from "./config.js";
import { Database } from "./db.js";
import { DiscordBot } from "./discord.js";
import { logError, logInfo } from "./logger.js";
import { createServer } from "./server.js";
import { AutoLiveService } from "./autolive-service.js";
import { TwitchClient } from "./twitch.js";

async function main() {
  const db = new Database(config.databaseUrl);
  await db.init();

  const twitch = new TwitchClient(config);
  const discordBot = new DiscordBot(config, db, twitch);
  const autolive = new AutoLiveService(config, db, discordBot, twitch);
  discordBot.setServices({ autolive });

  const app = createServer(config, twitch, autolive);
  app.listen(config.port, () => {
    logInfo("HTTP server listening", { port: config.port });
  });

  await discordBot.start();

  setInterval(async () => {
    try {
      await autolive.refreshBoardAndAlerts("interval");
    } catch (error) {
      logError("Scheduled refresh failed", error);
    }
  }, config.refreshIntervalSeconds * 1000);
}

main().catch((error) => {
  logError("Fatal startup error", error);
  process.exitCode = 1;
});
