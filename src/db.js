import pg from "pg";

const { Pool } = pg;

export class Database {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }
    });
  }

  async query(text, params = []) {
    return this.pool.query(text, params);
  }

  async init() {
    await this.query(`
      CREATE TABLE IF NOT EXISTS guild_config (
        guild_id TEXT PRIMARY KEY,
        channel_id TEXT,
        board_message_id TEXT,
        eligible_role_id TEXT,
        alert_role_id TEXT,
        alert_everyone BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS streamer_mappings (
        guild_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        twitch_login TEXT NOT NULL,
        twitch_display_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
        source TEXT NOT NULL CHECK (source IN ('claim', 'manual', 'role_seed')),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, discord_user_id)
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS eventsub_subscriptions (
        subscription_id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK (event_type IN ('stream.online', 'stream.offline')),
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.query(`
      CREATE TABLE IF NOT EXISTS live_sessions (
        guild_id TEXT NOT NULL,
        discord_user_id TEXT NOT NULL,
        twitch_user_id TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        started_at TIMESTAMPTZ NOT NULL,
        last_alerted_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (guild_id, discord_user_id)
      )
    `);
  }

  async getGuildConfig(guildId) {
    const result = await this.query(`SELECT * FROM guild_config WHERE guild_id = $1`, [guildId]);
    return result.rows[0] ?? null;
  }

  async upsertGuildConfig(guildId, patch) {
    const current = (await this.getGuildConfig(guildId)) ?? {
      guild_id: guildId,
      channel_id: null,
      board_message_id: null,
      eligible_role_id: null,
      alert_role_id: null,
      alert_everyone: true
    };

    const next = {
      ...current,
      ...patch,
      guild_id: guildId
    };

    const result = await this.query(
      `INSERT INTO guild_config (
        guild_id, channel_id, board_message_id, eligible_role_id, alert_role_id, alert_everyone, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (guild_id)
      DO UPDATE SET
        channel_id = EXCLUDED.channel_id,
        board_message_id = EXCLUDED.board_message_id,
        eligible_role_id = EXCLUDED.eligible_role_id,
        alert_role_id = EXCLUDED.alert_role_id,
        alert_everyone = EXCLUDED.alert_everyone,
        updated_at = NOW()
      RETURNING *`,
      [
        next.guild_id,
        next.channel_id,
        next.board_message_id,
        next.eligible_role_id,
        next.alert_role_id,
        next.alert_everyone
      ]
    );

    return result.rows[0];
  }

  async upsertStreamerMapping(mapping) {
    const result = await this.query(
      `INSERT INTO streamer_mappings (
        guild_id, discord_user_id, twitch_user_id, twitch_login, twitch_display_name, status, source, notes, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (guild_id, discord_user_id)
      DO UPDATE SET
        twitch_user_id = EXCLUDED.twitch_user_id,
        twitch_login = EXCLUDED.twitch_login,
        twitch_display_name = EXCLUDED.twitch_display_name,
        status = EXCLUDED.status,
        source = EXCLUDED.source,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *`,
      [
        mapping.guildId,
        mapping.discordUserId,
        mapping.twitchUserId,
        mapping.twitchLogin,
        mapping.twitchDisplayName,
        mapping.status,
        mapping.source,
        mapping.notes ?? null
      ]
    );

    return result.rows[0];
  }

  async listStreamerMappings(guildId, status = null) {
    const params = [guildId];
    let where = "guild_id = $1";
    if (status) {
      params.push(status);
      where += ` AND status = $${params.length}`;
    }

    const result = await this.query(
      `SELECT * FROM streamer_mappings WHERE ${where} ORDER BY status ASC, twitch_display_name ASC`,
      params
    );
    return result.rows;
  }

  async listApprovedMappings(guildId) {
    return this.listStreamerMappings(guildId, "approved");
  }

  async getStreamerMapping(guildId, discordUserId) {
    const result = await this.query(
      `SELECT * FROM streamer_mappings WHERE guild_id = $1 AND discord_user_id = $2`,
      [guildId, discordUserId]
    );
    return result.rows[0] ?? null;
  }

  async removeStreamerMapping(guildId, discordUserId) {
    await this.query(`DELETE FROM streamer_mappings WHERE guild_id = $1 AND discord_user_id = $2`, [guildId, discordUserId]);
    await this.query(`DELETE FROM live_sessions WHERE guild_id = $1 AND discord_user_id = $2`, [guildId, discordUserId]);
    await this.query(`DELETE FROM eventsub_subscriptions WHERE guild_id = $1 AND discord_user_id = $2`, [guildId, discordUserId]);
  }

  async saveEventsubSubscription(subscription) {
    await this.query(
      `INSERT INTO eventsub_subscriptions (
        subscription_id, guild_id, discord_user_id, twitch_user_id, event_type, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      ON CONFLICT (subscription_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = NOW()`,
      [
        subscription.subscriptionId,
        subscription.guildId,
        subscription.discordUserId,
        subscription.twitchUserId,
        subscription.eventType,
        subscription.status
      ]
    );
  }

  async listEventsubSubscriptionsForUser(guildId, discordUserId) {
    const result = await this.query(
      `SELECT * FROM eventsub_subscriptions WHERE guild_id = $1 AND discord_user_id = $2`,
      [guildId, discordUserId]
    );
    return result.rows;
  }

  async deleteEventsubSubscription(subscriptionId) {
    await this.query(`DELETE FROM eventsub_subscriptions WHERE subscription_id = $1`, [subscriptionId]);
  }

  async upsertLiveSession(session) {
    const result = await this.query(
      `INSERT INTO live_sessions (
        guild_id, discord_user_id, twitch_user_id, stream_id, started_at, last_alerted_at, last_seen_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (guild_id, discord_user_id)
      DO UPDATE SET
        twitch_user_id = EXCLUDED.twitch_user_id,
        stream_id = EXCLUDED.stream_id,
        started_at = EXCLUDED.started_at,
        last_alerted_at = COALESCE(live_sessions.last_alerted_at, EXCLUDED.last_alerted_at),
        last_seen_at = NOW()
      RETURNING *`,
      [
        session.guildId,
        session.discordUserId,
        session.twitchUserId,
        session.streamId,
        session.startedAt,
        session.lastAlertedAt ?? null
      ]
    );
    return result.rows[0];
  }

  async markLiveSessionAlerted(guildId, discordUserId) {
    await this.query(
      `UPDATE live_sessions SET last_alerted_at = NOW() WHERE guild_id = $1 AND discord_user_id = $2`,
      [guildId, discordUserId]
    );
  }

  async deleteLiveSession(guildId, discordUserId) {
    await this.query(`DELETE FROM live_sessions WHERE guild_id = $1 AND discord_user_id = $2`, [guildId, discordUserId]);
  }

  async close() {
    await this.pool.end();
  }
}
