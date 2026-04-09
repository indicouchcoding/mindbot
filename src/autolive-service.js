import { logInfo, logWarn } from "./logger.js";
import { TwitchClient } from "./twitch.js";

function hasEligibleRole(member, eligibleRoleId) {
  if (!eligibleRoleId) {
    return true;
  }
  return member.roles.cache.has(eligibleRoleId);
}

export class AutoLiveService {
  constructor(config, db, discordBot, twitchClient) {
    this.config = config;
    this.db = db;
    this.discordBot = discordBot;
    this.twitch = twitchClient;
  }

  async claimStreamer(guild, member, twitchLogin) {
    const guildConfig = await this.db.getGuildConfig(guild.id);
    if (!guildConfig) {
      throw new Error("Auto-live is not configured yet.");
    }

    if (!hasEligibleRole(member, guildConfig.eligible_role_id)) {
      throw new Error("You are not allowed to submit a claim for auto-live.");
    }

    return this.addOrUpdateStreamer(guild, member.id, twitchLogin, "claim", "pending");
  }

  async addOrUpdateStreamer(guild, discordUserId, twitchLogin, source, status) {
    const member = await guild.members.fetch(discordUserId);
    const guildConfig = await this.db.getGuildConfig(guild.id);
    if (source === "claim" && guildConfig?.eligible_role_id && !hasEligibleRole(member, guildConfig.eligible_role_id)) {
      throw new Error("Member does not have the eligible role.");
    }

    const twitchUser = await this.twitch.lookupUserByLogin(twitchLogin);
    if (!twitchUser) {
      throw new Error("Twitch account not found.");
    }

    const mapping = await this.db.upsertStreamerMapping({
      guildId: guild.id,
      discordUserId,
      twitchUserId: twitchUser.id,
      twitchLogin: twitchUser.login,
      twitchDisplayName: twitchUser.display_name,
      status,
      source,
      notes: null
    });

    if (status === "approved") {
      await this.ensureSubscriptionsForMapping(mapping);
      await this.refreshBoardAndAlerts("mapping-approved");
    }

    return mapping;
  }

  async changeMappingStatus(guild, discordUserId, status) {
    const current = await this.db.getStreamerMapping(guild.id, discordUserId);
    if (!current) {
      throw new Error("Streamer mapping not found.");
    }

    const updated = await this.db.upsertStreamerMapping({
      guildId: guild.id,
      discordUserId,
      twitchUserId: current.twitch_user_id,
      twitchLogin: current.twitch_login,
      twitchDisplayName: current.twitch_display_name,
      status,
      source: current.source,
      notes: current.notes
    });

    if (status === "approved") {
      await this.ensureSubscriptionsForMapping(updated);
    } else {
      await this.deleteSubscriptionsForMapping(updated);
      await this.db.deleteLiveSession(guild.id, discordUserId);
    }

    await this.refreshBoardAndAlerts(`mapping-${status}`);
    return updated;
  }

  async removeStreamer(guild, discordUserId) {
    const mapping = await this.db.getStreamerMapping(guild.id, discordUserId);
    if (mapping) {
      await this.deleteSubscriptionsForMapping(mapping);
    }
    await this.db.removeStreamerMapping(guild.id, discordUserId);
    await this.refreshBoardAndAlerts("mapping-removed");
  }

  async handleGuildMemberRemoved(guildId, discordUserId) {
    const mapping = await this.db.getStreamerMapping(guildId, discordUserId);
    if (!mapping) {
      return;
    }

    await this.deleteSubscriptionsForMapping(mapping);
    await this.db.removeStreamerMapping(guildId, discordUserId);
    await this.refreshBoardAndAlerts("member-removed");
  }

  async syncApprovedStreamerSubscriptions() {
    const guild = await this.discordBot.getGuild();
    const approved = await this.db.listApprovedMappings(guild.id);
    for (const mapping of approved) {
      try {
        await guild.members.fetch(mapping.discord_user_id);
        await this.ensureSubscriptionsForMapping(mapping);
      } catch (error) {
        logWarn("Removing stale mapping during subscription sync", {
          discordUserId: mapping.discord_user_id,
          error: error.message
        });
        await this.removeStreamer(guild, mapping.discord_user_id);
      }
    }
  }

  async ensureSubscriptionsForMapping(mapping) {
    const existing = await this.db.listEventsubSubscriptionsForUser(mapping.guild_id, mapping.discord_user_id);
    const eventTypes = new Set(existing.map((subscription) => subscription.event_type));
    for (const eventType of ["stream.online", "stream.offline"]) {
      if (eventTypes.has(eventType)) {
        continue;
      }
      this.twitch.logSubscriptionSeed(eventType, mapping.twitch_user_id);
      const subscription = await this.twitch.createEventsubSubscription(eventType, mapping.twitch_user_id);
      await this.db.saveEventsubSubscription({
        subscriptionId: subscription.id,
        guildId: mapping.guild_id,
        discordUserId: mapping.discord_user_id,
        twitchUserId: mapping.twitch_user_id,
        eventType,
        status: subscription.status
      });
    }
  }

  async deleteSubscriptionsForMapping(mapping) {
    const existing = await this.db.listEventsubSubscriptionsForUser(mapping.guild_id, mapping.discord_user_id);
    for (const subscription of existing) {
      await this.twitch.deleteEventsubSubscription(subscription.subscription_id).catch((error) => {
        logWarn("Failed to delete Twitch EventSub subscription", {
          subscriptionId: subscription.subscription_id,
          error: error.message
        });
      });
      await this.db.deleteEventsubSubscription(subscription.subscription_id);
    }
  }

  async refreshBoardAndAlerts(reason) {
    const guild = await this.discordBot.getGuild();
    const guildConfig = await this.db.getGuildConfig(guild.id);
    if (!guildConfig?.channel_id) {
      logWarn("Skipping refresh because auto-live is not configured", { reason });
      return 0;
    }

    const approvedMappings = await this.db.listApprovedMappings(guild.id);
    const liveEntries = [];
    const userIdToMapping = new Map(approvedMappings.map((mapping) => [mapping.twitch_user_id, mapping]));
    const streams = await this.twitch.getStreamsByUserIds(approvedMappings.map((mapping) => mapping.twitch_user_id));

    for (const stream of streams.map(TwitchClient.normalizeStream)) {
      const mapping = userIdToMapping.get(stream.twitchUserId);
      if (!mapping) {
        continue;
      }

      try {
        const member = await guild.members.fetch(mapping.discord_user_id);
        if (guildConfig.eligible_role_id && !hasEligibleRole(member, guildConfig.eligible_role_id)) {
          continue;
        }
      } catch {
        continue;
      }

      liveEntries.push({
        ...stream,
        discordUserId: mapping.discord_user_id
      });

      const session = await this.db.upsertLiveSession({
        guildId: guild.id,
        discordUserId: mapping.discord_user_id,
        twitchUserId: stream.twitchUserId,
        streamId: stream.streamId,
        startedAt: stream.startedAt
      });

      if (!session.last_alerted_at) {
        await this.discordBot.sendLiveAlert(guildConfig, stream);
        await this.db.markLiveSessionAlerted(guild.id, mapping.discord_user_id);
      }
    }

    const liveUserIds = new Set(liveEntries.map((entry) => entry.discordUserId));
    for (const mapping of approvedMappings) {
      if (!liveUserIds.has(mapping.discord_user_id)) {
        await this.db.deleteLiveSession(guild.id, mapping.discord_user_id);
      }
    }

    await this.discordBot.updateBoard(guildConfig, liveEntries);
    logInfo("Refreshed live board", { reason, liveCount: liveEntries.length });
    return liveEntries.length;
  }

  async handleTwitchOnlineEvent(event) {
    const guild = await this.discordBot.getGuild();
    const approved = await this.db.listApprovedMappings(guild.id);
    const mapping = approved.find((item) => item.twitch_user_id === event.broadcaster_user_id);
    if (!mapping) {
      return;
    }
    await this.refreshBoardAndAlerts("eventsub-online");
  }

  async handleTwitchOfflineEvent(event) {
    const guild = await this.discordBot.getGuild();
    const approved = await this.db.listApprovedMappings(guild.id);
    const mapping = approved.find((item) => item.twitch_user_id === event.broadcaster_user_id);
    if (!mapping) {
      return;
    }
    await this.db.deleteLiveSession(guild.id, mapping.discord_user_id);
    await this.refreshBoardAndAlerts("eventsub-offline");
  }
}
