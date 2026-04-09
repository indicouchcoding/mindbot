# Owner Setup Notes

Use this file as a short version of the README.

## Minimum setup

1. Create the Discord bot and copy:
   - `DISCORD_TOKEN`
   - `DISCORD_CLIENT_ID`
   - `DISCORD_GUILD_ID`
2. Create the Twitch app and copy:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
   - `TWITCH_EVENTSUB_SECRET`
3. Create Railway project and copy:
   - `DATABASE_URL`
   - `PUBLIC_BASE_URL`
4. Put those values into `.env` and Railway Variables.
5. Deploy.
6. Run `/autolive-setup` in Discord.

## Main moderator commands

- `/streamer-add`
- `/streamer-approve`
- `/streamer-reject`
- `/streamer-remove`
- `/streamer-list`
- `/autolive-refresh`

## If something breaks

- Run `npm run validate:env`
- Check Railway logs
- Confirm the bot is still in the Discord server
- Confirm the Twitch and Railway values are still correct
