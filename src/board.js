import { EmbedBuilder } from "discord.js";

function formatDuration(startedAt) {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function buildBoardPayload(liveEntries, guildName) {
  const sorted = [...liveEntries].sort((a, b) => a.twitchDisplayName.localeCompare(b.twitchDisplayName));
  const visibleEntries = sorted.slice(0, 25);

  const embed = new EmbedBuilder()
    .setColor(0x69576f)
    .setTitle(`${guildName} Live: Currently Live`)
    .setDescription(
      visibleEntries.length === 0
        ? "No approved MindLab members are live right now."
        : `Live now: ${visibleEntries.length}${sorted.length > visibleEntries.length ? ` of ${sorted.length}` : ""}`
    )
    .setTimestamp(new Date());

  for (const entry of visibleEntries) {
    embed.addFields({
      name: entry.twitchDisplayName,
      value: [
        `[${entry.gameName}](https://twitch.tv/${entry.twitchLogin})`,
        `Eyes: ${entry.viewerCount} viewers`,
        `Hourglass: ${formatDuration(entry.startedAt)}`
      ].join("\n"),
      inline: true
    });
  }

  if (sorted.length > visibleEntries.length) {
    embed.addFields({
      name: "Additional Live Members",
      value: `${sorted.length - visibleEntries.length} more streamers are live than Discord can show in one embed.`,
      inline: false
    });
  }

  return { embeds: [embed] };
}
