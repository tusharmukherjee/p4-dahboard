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
