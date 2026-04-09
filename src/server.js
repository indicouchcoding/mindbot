import express from "express";

import { logWarn } from "./logger.js";

export function createServer(_config, twitch, autolive) {
  const app = express();

  app.use("/twitch/eventsub", express.raw({ type: "application/json" }));
  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.post("/twitch/eventsub", async (request, response) => {
    const rawBody = request.body instanceof Buffer ? request.body.toString("utf8") : "";
    if (!twitch.verifyEventsubSignature(request.headers, rawBody)) {
      response.status(403).send("Invalid signature");
      return;
    }

    const type = request.headers["twitch-eventsub-message-type"];
    const payload = JSON.parse(rawBody);
    if (type === "webhook_callback_verification") {
      response.status(200).send(payload.challenge);
      return;
    }

    if (type === "notification") {
      response.status(204).send();
      try {
        if (payload.subscription?.type === "stream.online") {
          await autolive.handleTwitchOnlineEvent(payload.event);
        } else if (payload.subscription?.type === "stream.offline") {
          await autolive.handleTwitchOfflineEvent(payload.event);
        }
      } catch (error) {
        logWarn("Failed to process EventSub notification", { error: error.message });
      }
      return;
    }

    response.status(204).send();
  });

  return app;
}
