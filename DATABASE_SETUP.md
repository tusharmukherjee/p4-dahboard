# Neon database setup

## 1. Create the database

Create a Neon project and copy its PostgreSQL connection string into `.env`:

```env
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
```

## 2. Configure authentication and encryption

```env
SYSTEM_USERNAME=admin
SYSTEM_PASSWORD=choose-a-long-password
TOKEN_ENCRYPTION_KEY=replace-with-a-generated-key
```

Generate the encryption key once:

```bash
openssl rand -base64 32
```

Do not change that key after tokens have been saved. A changed or lost key
means the encrypted tokens can no longer be read.

`SYSTEM_PASSWORD` is optional during the first startup. If omitted, the
server generates a password and prints it once. The database stores only a
scrypt password hash, never the original password.

## 3. Create the tables

```bash
npm run db:migrate
```

When `src/db/schema.ts` changes later, create and apply another migration:

```bash
npm run db:generate
npm run db:migrate
```

## 4. Start and authorize Spotify

```bash
npm run dev
```

Open the Spotify authorization endpoint using Basic Authentication:

```bash
curl -u "admin:your-password" -L http://127.0.0.1:3000/spotify/login
```

After Spotify redirects to `/callback`, the encrypted access and refresh
tokens are saved in `oauth_tokens`. The same table can later store Google
tokens by using `google` as the provider.

Protected module requests also require Basic Authentication:

```bash
curl -u "admin:your-password" \
  -X POST http://127.0.0.1:3000/api/modules/hacker-news/data \
  -H "Content-Type: application/json" \
  -d '{"version":10,"payload":{"batchSize":5}}'
```

The ESP can check for configuration changes without requesting module data:

```bash
curl -u "admin:your-password" \
  "http://127.0.0.1:3000/api/configuration/sync?version=14"
```

When the version is current, the response only contains `changed: false` and
the current `version`. When it differs, `changed` is `true` and the response
also contains the complete updated `configuration` for the ESP to store.

Basic Authentication uses Base64 encoding, not encryption. Use HTTPS when
the API is accessed outside a trusted local network.

## Google Calendar authorization

Enable the Google Calendar API in Google Cloud, create a Web application
OAuth client, and add the exact callback URL to its authorized redirect URIs:

```text
https://your-ngrok-domain.ngrok-free.app/google/callback
```

Configure the matching values in `.env`:

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-ngrok-domain.ngrok-free.app/google/callback
```

Start authorization in a browser. Basic Auth protects this starting URL; the
callback is protected by the one-time OAuth state value instead:

```text
https://your-ngrok-domain.ngrok-free.app/google/login
```

Google access and refresh tokens are encrypted and stored in the existing
`oauth_tokens` table with `provider = 'google'`.

## Football display

Apply the latest migration before using football:

```bash
npm run db:migrate
```

The migration adds a disabled **Football** module to existing configurations;
new installations include it in the seed. In the configuration studio, enter
the football-data.org API token under **Football integration**, then open the
Football module and choose a country, competition, and team. Enable the module
and publish the configuration. The token is validated against
the provider before it is encrypted with `TOKEN_ENCRYPTION_KEY` and stored in
`oauth_tokens`; it is never returned by the API or sent to the ESP.

The Basic Auth protected endpoints are:

- `GET /api/football/token` — whether a token is configured.
- `PUT /api/football/token` — `{ "token": "..." }` to validate and replace it.
- `GET /api/football/competitions` — competition choices.
- `GET /api/football/competitions/:code/teams` — team choices.
- `POST /api/modules/football/data` — ESP response, using the normal
  `{ "version": 15, "payload": { "competitionCode": "SA", "teamId": 107 } }` shape.

The provider's catalog and match results are cached in Neon. Upcoming fixtures
are refreshed at most every six hours, or sooner at kickoff. Live results are
refreshed at most once per minute. The ESP requests the football module every
60 seconds while it is displayed. The selected competition is used to find the
team in the frontend; upcoming and live results cover all competitions that
team plays in. Each match response includes its actual competition code.
