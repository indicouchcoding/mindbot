import {
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";

import { buildBoardPayload } from "./board.js";
import { logInfo, logWarn } from "./logger.js";

function chunkText(items, max = 1800) {
  const chunks = [];
  let current = "";
  for (const item of items) {
    const next = current ? `${current}\n${item}` : item;
    if (next.length > max) {
      if (current) {
        chunks.push(current);
      }
      current = item;
    } else {
      current = next;
    }
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

export class DiscordBot {
  constructor(config, db, twitch) {
    this.config = config;
    this.db = db;
    this.twitch = twitch;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });
    this.guild = null;
    this.services = null;
  }

  setServices(services) {
    this.services = services;
  }

  async start() {
    this.client.once("ready", async () => {
      this.guild = await this.client.guilds.fetch(this.config.discordGuildId);
      logInfo("Discord bot ready", { guildId: this.guild.id, botUser: this.client.user?.tag });
      await this.registerCommands();
      await this.services.autolive.syncApprovedStreamerSubscriptions();
      await this.services.autolive.refreshBoardAndAlerts("startup");
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) {
        return;
      }

      try {
        await this.handleCommand(interaction);
      } catch (error) {
        logWarn("Command handling failed", { command: interaction.commandName, error: error.message });
        const content = `Command failed: ${error.message}`;
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content, ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content, ephemeral: true }).catch(() => {});
        }
      }
    });

    this.client.on("guildMemberRemove", async (member) => {
      await this.services.autolive.handleGuildMemberRemoved(member.guild.id, member.id);
    });

    await this.client.login(this.config.discordToken);
  }

  buildCommands() {
    return [
      new SlashCommandBuilder()
        .setName("autolive-setup")
        .setDescription("Configure the auto-live channel and role behavior.")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Target auto-live channel.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption((option) =>
          option.setName("eligible_role").setDescription("Members with this role can submit streamer claims.")
        )
        .addRoleOption((option) =>
          option.setName("alert_role").setDescription("Optional role to mention instead of @everyone.")
        )
        .addBooleanOption((option) =>
          option.setName("alert_everyone").setDescription("Mention @everyone for live alerts.")
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      new SlashCommandBuilder()
        .setName("streamer-claim")
        .setDescription("Claim your Twitch account for moderator approval.")
        .addStringOption((option) =>
          option.setName("twitch_login").setDescription("Your Twitch username.").setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName("streamer-add")
        .setDescription("Add or replace a streamer mapping.")
        .addUserOption((option) => option.setName("discord_user").setDescription("Discord member.").setRequired(true))
        .addStringOption((option) =>
          option.setName("twitch_login").setDescription("Twitch username.").setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      new SlashCommandBuilder()
        .setName("streamer-approve")
        .setDescription("Approve a pending streamer mapping.")
        .addUserOption((option) => option.setName("discord_user").setDescription("Discord member.").setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      new SlashCommandBuilder()
        .setName("streamer-reject")
        .setDescription("Reject a pending streamer mapping.")
        .addUserOption((option) => option.setName("discord_user").setDescription("Discord member.").setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      new SlashCommandBuilder()
        .setName("streamer-remove")
        .setDescription("Remove a streamer mapping.")
        .addUserOption((option) => option.setName("discord_user").setDescription("Discord member.").setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      new SlashCommandBuilder()
        .setName("streamer-list")
        .setDescription("List pending and approved streamer mappings.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
      new SlashCommandBuilder()
        .setName("autolive-refresh")
        .setDescription("Refresh the live board immediately.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    ].map((command) => command.toJSON());
  }

  async registerCommands() {
    const rest = new REST({ version: "10" }).setToken(this.config.discordToken);
    await rest.put(Routes.applicationGuildCommands(this.config.discordClientId, this.config.discordGuildId), {
      body: this.buildCommands()
    });
    logInfo("Registered slash commands");
  }

  async handleCommand(interaction) {
    switch (interaction.commandName) {
      case "autolive-setup":
        return this.handleSetup(interaction);
      case "streamer-claim":
        return this.handleClaim(interaction);
      case "streamer-add":
        return this.handleAdd(interaction);
      case "streamer-approve":
        return this.handleApprove(interaction);
      case "streamer-reject":
        return this.handleReject(interaction);
      case "streamer-remove":
        return this.handleRemove(interaction);
      case "streamer-list":
        return this.handleList(interaction);
      case "autolive-refresh":
        return this.handleRefresh(interaction);
      default:
        return interaction.reply({ content: "Unknown command.", ephemeral: true });
    }
  }

  async handleSetup(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const channel = interaction.options.getChannel("channel", true);
    const eligibleRole = interaction.options.getRole("eligible_role");
    const alertRole = interaction.options.getRole("alert_role");
    const alertEveryone = interaction.options.getBoolean("alert_everyone");

    const configPatch = {
      channel_id: channel.id,
      eligible_role_id: eligibleRole?.id ?? null,
      alert_role_id: alertRole?.id ?? null,
      alert_everyone: alertEveryone ?? this.config.defaultAlertEveryone,
      board_message_id: null
    };

    await this.db.upsertGuildConfig(interaction.guildId, configPatch);
    const message = await channel.send(buildBoardPayload([], interaction.guild.name));
    await this.db.upsertGuildConfig(interaction.guildId, { ...configPatch, board_message_id: message.id });
    await this.services.autolive.refreshBoardAndAlerts("setup");
    await interaction.editReply(`Auto-live configured for ${channel}. Board message created: ${message.id}`);
  }

  async handleClaim(interaction) {
    await interaction.deferReply({ ephemeral: true });
    await this.services.autolive.claimStreamer(interaction.guild, interaction.member, interaction.options.getString("twitch_login", true));
    await interaction.editReply("Claim submitted for moderator approval.");
  }

  async handleAdd(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const discordUser = interaction.options.getUser("discord_user", true);
    const twitchLogin = interaction.options.getString("twitch_login", true);
    const mapping = await this.services.autolive.addOrUpdateStreamer(interaction.guild, discordUser.id, twitchLogin, "manual", "approved");
    await interaction.editReply(`Approved ${mapping.twitch_display_name} for <@${discordUser.id}>.`);
  }

  async handleApprove(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const discordUser = interaction.options.getUser("discord_user", true);
    const mapping = await this.services.autolive.changeMappingStatus(interaction.guild, discordUser.id, "approved");
    await interaction.editReply(`Approved ${mapping.twitch_display_name} for <@${discordUser.id}>.`);
  }

  async handleReject(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const discordUser = interaction.options.getUser("discord_user", true);
    const mapping = await this.services.autolive.changeMappingStatus(interaction.guild, discordUser.id, "rejected");
    await interaction.editReply(`Rejected ${mapping.twitch_display_name} for <@${discordUser.id}>.`);
  }

  async handleRemove(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const discordUser = interaction.options.getUser("discord_user", true);
    await this.services.autolive.removeStreamer(interaction.guild, discordUser.id);
    await interaction.editReply(`Removed streamer mapping for <@${discordUser.id}>.`);
  }

  async handleList(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const mappings = await this.db.listStreamerMappings(interaction.guildId);
    if (mappings.length === 0) {
      await interaction.editReply("No streamer mappings found.");
      return;
    }

    const lines = mappings.map(
      (mapping) =>
        `<@${mapping.discord_user_id}> -> ${mapping.twitch_display_name} (${mapping.twitch_login}) [${mapping.status}]`
    );

    const chunks = chunkText(lines);
    await interaction.editReply(chunks[0]);
    for (const chunk of chunks.slice(1)) {
      await interaction.followUp({ content: chunk, ephemeral: true });
    }
  }

  async handleRefresh(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const count = await this.services.autolive.refreshBoardAndAlerts("manual");
    await interaction.editReply(`Board refreshed. ${count} approved members are currently live.`);
  }

  async getGuild() {
    if (!this.guild) {
      this.guild = await this.client.guilds.fetch(this.config.discordGuildId);
    }
    return this.guild;
  }

  async ensureBoardMessage(guildConfig) {
    if (!guildConfig?.channel_id) {
      throw new Error("Auto-live is not configured. Run /autolive-setup first.");
    }

    const guild = await this.getGuild();
    const channel = await guild.channels.fetch(guildConfig.channel_id);
    if (!channel?.isTextBased()) {
      throw new Error("Configured auto-live channel is not text-based.");
    }

    if (guildConfig.board_message_id) {
      try {
        const existing = await channel.messages.fetch(guildConfig.board_message_id);
        return existing;
      } catch {
        logWarn("Tracked board message missing, recreating", { boardMessageId: guildConfig.board_message_id });
      }
    }

    const created = await channel.send(buildBoardPayload([], guild.name));
    await this.db.upsertGuildConfig(guild.id, { ...guildConfig, board_message_id: created.id });
    return created;
  }

  async updateBoard(guildConfig, liveEntries) {
    const guild = await this.getGuild();
    const boardMessage = await this.ensureBoardMessage(guildConfig);
    await boardMessage.edit(buildBoardPayload(liveEntries, guild.name));
  }

  async sendLiveAlert(guildConfig, entry) {
    if (!guildConfig?.channel_id) {
      return;
    }

    const guild = await this.getGuild();
    const channel = await guild.channels.fetch(guildConfig.channel_id);
    if (!channel?.isTextBased()) {
      return;
    }

    const mention = guildConfig.alert_everyone
      ? "@everyone"
      : guildConfig.alert_role_id
        ? `<@&${guildConfig.alert_role_id}>`
        : "";

    const embed = new EmbedBuilder()
      .setColor(0x7fb2ff)
      .setTitle(`${entry.twitchDisplayName} is live`)
      .setURL(`https://twitch.tv/${entry.twitchLogin}`)
      .setDescription(entry.title || entry.gameName)
      .addFields(
        { name: "Game", value: entry.gameName || "Unknown Game", inline: true },
        { name: "Viewers", value: String(entry.viewerCount ?? "0"), inline: true }
      )
      .setTimestamp(new Date(entry.startedAt));

    await channel.send({
      content: `${mention} ${entry.twitchDisplayName} just went live: https://twitch.tv/${entry.twitchLogin}`.trim(),
      embeds: [embed],
      allowedMentions: {
        parse: guildConfig.alert_everyone ? ["everyone"] : [],
        roles: guildConfig.alert_role_id && !guildConfig.alert_everyone ? [guildConfig.alert_role_id] : []
      }
    });
  }
}
