# MindLab Auto-Live Bot

This bot keeps one live dashboard message updated in Discord and sends a one-time alert when an approved MindLab member goes live on Twitch.

## What your friend needs to do

She only needs to do four things:

1. Create the Discord bot.
2. Create the Twitch app.
3. Fill in the values in `.env`.
4. Deploy the repo to Railway.

After that, she runs one Discord command to finish setup.

## Fast setup checklist

Before starting, she should have:

- A Discord server where she has admin rights.
- A Twitch account with access to the developer console.
- A GitHub account.
- A Railway account.

## Step 1: Put this project on GitHub

1. Upload this repo to a new GitHub repository.
2. Keep the repo private if she does not want anyone else seeing the code.
3. Do not commit the real `.env` file.

## Step 2: Create the Discord bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications).
2. Click `New Application` and give it a name.
3. Open the `Bot` tab.
4. Click `Add Bot`.
5. Turn on `Server Members Intent`.
6. Copy these values for later:
   - Bot token -> `DISCORD_TOKEN`
   - Application ID -> `DISCORD_CLIENT_ID`
7. Turn on Developer Mode in Discord if needed:
   `User Settings` -> `Advanced` -> `Developer Mode`.
8. Right-click the MindLab server and copy the server ID:
   - Server ID -> `DISCORD_GUILD_ID`

### Invite the bot to the server

Use the Discord OAuth URL generator or build an invite link with these scopes and permissions:

- Scopes: `bot`, `applications.commands`
- Permissions: `View Channels`, `Send Messages`, `Manage Messages`, `Embed Links`, `Mention Everyone`

## Step 3: Create the Twitch app

1. Go to [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Create a new application.
3. Set the OAuth Redirect URL to any valid HTTPS URL for now.
   Example: `https://example.com`
4. Set the category to something like `Chat Bot`.
5. Copy these values:
   - Client ID -> `TWITCH_CLIENT_ID`
   - Client Secret -> `TWITCH_CLIENT_SECRET`
6. Create a long random secret for webhook validation:
   - This becomes `TWITCH_EVENTSUB_SECRET`
   - Make it at least 12 characters, longer is better

## Step 4: Create the Railway project

1. Go to [Railway](https://railway.com/).
2. Create a new project from the GitHub repo.
3. Add a PostgreSQL service.
4. Open the app service variables page.
5. Railway will provide the Postgres connection string:
   - `DATABASE_URL`
6. After the first deploy, Railway will give the project a public URL:
   - That becomes `PUBLIC_BASE_URL`

## Step 5: Fill in the environment file

1. Copy `.env.example` to `.env`.
2. Fill in every blank value.
3. Leave `PORT=3000` unless Railway says otherwise.
4. Leave `REFRESH_INTERVAL_SECONDS=90` unless she wants faster or slower updates.
5. Leave `DEFAULT_ALERT_EVERYONE=true` if alerts should ping everyone by default.

### Example `.env`

```env
DISCORD_TOKEN=discord-bot-token-here
DISCORD_CLIENT_ID=123456789012345678
DISCORD_GUILD_ID=987654321098765432
DATABASE_URL=postgresql://...
TWITCH_CLIENT_ID=twitch-client-id-here
TWITCH_CLIENT_SECRET=twitch-client-secret-here
TWITCH_EVENTSUB_SECRET=use-a-long-random-secret-here
PUBLIC_BASE_URL=https://your-app-name.up.railway.app
PORT=3000
REFRESH_INTERVAL_SECONDS=90
DEFAULT_ALERT_EVERYONE=true
```

## Step 6: Validate before deploy

Run:

```bash
npm install
npm run validate:env
```

If the validator says `Environment looks valid.`, the config is ready.

## Step 7: Deploy to Railway

1. Make sure all env vars from `.env` are also entered in Railway Variables.
2. Deploy the app.
3. Once Railway assigns the real public URL, update `PUBLIC_BASE_URL` if needed.
4. Redeploy after changing `PUBLIC_BASE_URL`.
5. Check the health endpoint in a browser:
   `https://your-app-name.up.railway.app/health`
6. If setup is correct, it should return JSON with `ok: true`.

## Step 8: Finish setup inside Discord

Once the bot is online in the server, run:

```text
/autolive-setup
```

Choose:

- `channel`: the auto-live channel
- `eligible_role`: optional role for members allowed to submit their own Twitch account
- `alert_role`: optional role to ping instead of `@everyone`
- `alert_everyone`: `true` or `false`

That command creates the live dashboard message.

## Moderator commands

These are the only commands your friend really needs day to day:

- `/streamer-add` to manually add a streamer
- `/streamer-approve` to approve a self-submitted claim
- `/streamer-reject` to reject a claim
- `/streamer-remove` to remove a streamer
- `/streamer-list` to see pending and approved people
- `/autolive-refresh` to force a refresh

## Self-service member flow

1. A member with the allowed role runs:
   `/streamer-claim twitch_login:<theirname>`
2. The bot stores that claim as pending.
3. A moderator approves it with `/streamer-approve`.
4. After approval, that member can appear in auto-live when they stream.

## What the bot does automatically

- Keeps one live board message updated.
- Sends one alert when an approved streamer goes live.
- Removes people from the board when they go offline.
- Refuses to show people who are no longer in the Discord server.
- Recreates the board if the tracked message is deleted.

## Troubleshooting

### Bot is online but commands do not appear

- Make sure `DISCORD_GUILD_ID` is correct.
- Make sure the bot was invited with `applications.commands` scope.
- Restart the bot once after fixing env values.

### Twitch alerts are not arriving

- Make sure `PUBLIC_BASE_URL` is the real Railway HTTPS URL.
- Make sure the Railway app is publicly reachable.
- Make sure `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, and `TWITCH_EVENTSUB_SECRET` are correct.

### The board exists but nobody shows up

- The member must have an approved mapping.
- The member must still be in the Discord server.
- If `eligible_role` is set, role-gated claims still need moderator approval before appearing.

### The bot crashes on startup

- Run `npm run validate:env`.
- Check Railway logs.
- Confirm `DATABASE_URL` points to a working Postgres instance.

## Files that matter most

- `.env.example`: all required settings
- `README.md`: this setup guide
- `src/discord.js`: commands and Discord behavior
- `src/autolive-service.js`: live-tracking logic
- `src/twitch.js`: Twitch API and EventSub logic

## Recommended handoff note

If you are handing this to a non-coder, tell them this:

"Fill in the environment values, deploy it to Railway, run `/autolive-setup`, and then use the slash commands to approve or remove streamers."
