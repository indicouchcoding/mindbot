import crypto from "node:crypto";

import { logInfo } from "./logger.js";

const TWITCH_API = "https://api.twitch.tv/helix";
const TWITCH_OAUTH = "https://id.twitch.tv/oauth2/token";
const TWITCH_EVENTSUB = "https://api.twitch.tv/helix/eventsub/subscriptions";

export class TwitchClient {
  constructor(config) {
    this.config = config;
    this.appToken = null;
    this.appTokenExpiresAt = 0;
  }

  async getAppAccessToken() {
    if (this.appToken && Date.now() < this.appTokenExpiresAt - 60000) {
      return this.appToken;
    }

    const response = await fetch(TWITCH_OAUTH, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.twitchClientId,
        client_secret: this.config.twitchClientSecret,
        grant_type: "client_credentials"
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Twitch app token: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    this.appToken = payload.access_token;
    this.appTokenExpiresAt = Date.now() + (payload.expires_in * 1000);
    return this.appToken;
  }

  async request(path, options = {}) {
    const token = await this.getAppAccessToken();
    const response = await fetch(`${TWITCH_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.config.twitchClientId,
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      }
    });

    if (!response.ok) {
      throw new Error(`Twitch API ${path} failed: ${response.status} ${await response.text()}`);
    }

    return response.json();
  }

  async lookupUserByLogin(login) {
    const payload = await this.request(`/users?login=${encodeURIComponent(login)}`);
    return payload.data?.[0] ?? null;
  }

  async getStreamsByUserIds(userIds) {
    if (userIds.length === 0) {
      return [];
    }

    const query = userIds.map((id) => `user_id=${encodeURIComponent(id)}`).join("&");
    const payload = await this.request(`/streams?${query}`);
    return payload.data ?? [];
  }

  async createEventsubSubscription(type, twitchUserId) {
    const token = await this.getAppAccessToken();
    const callback = `${this.config.publicBaseUrl}/twitch/eventsub`;
    const response = await fetch(TWITCH_EVENTSUB, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.config.twitchClientId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type,
        version: "1",
        condition: { broadcaster_user_id: twitchUserId },
        transport: {
          method: "webhook",
          callback,
          secret: this.config.twitchEventsubSecret
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create EventSub subscription: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    return payload.data?.[0] ?? null;
  }

  async deleteEventsubSubscription(subscriptionId) {
    const token = await this.getAppAccessToken();
    const response = await fetch(`${TWITCH_EVENTSUB}?id=${encodeURIComponent(subscriptionId)}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.config.twitchClientId
      }
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete EventSub subscription ${subscriptionId}: ${response.status} ${await response.text()}`);
    }
  }

  verifyEventsubSignature(headers, rawBody) {
    const id = headers["twitch-eventsub-message-id"];
    const timestamp = headers["twitch-eventsub-message-timestamp"];
    const signature = headers["twitch-eventsub-message-signature"];

    if (!id || !timestamp || !signature) {
      return false;
    }

    const expected = `sha256=${crypto
      .createHmac("sha256", this.config.twitchEventsubSecret)
      .update(id + timestamp + rawBody)
      .digest("hex")}`;

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  static normalizeStream(stream) {
    return {
      streamId: stream.id,
      twitchUserId: stream.user_id,
      twitchLogin: stream.user_login,
      twitchDisplayName: stream.user_name,
      title: stream.title,
      gameName: stream.game_name || "Unknown Game",
      viewerCount: stream.viewer_count,
      startedAt: stream.started_at,
      thumbnailUrl: stream.thumbnail_url
    };
  }

  logSubscriptionSeed(type, twitchUserId) {
    logInfo("Ensuring EventSub subscription", { type, twitchUserId });
  }
}
