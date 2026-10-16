# Navidrome OMSP Adapter

A small protocol adapter that lets Cloud Share (云享社音乐 / Edge-Music) browse and play a Navidrome library through its OpenSubsonic API.

```text
Cloud Share ── OMSP ──> Adapter ── OpenSubsonic ──> Navidrome ──> music library
```

The adapter translates requests and metadata. It does not scan folders, maintain a music database, or store audio. The upstream protocol contract is documented in [docs/cloudshare-api-contract.md](docs/cloudshare-api-contract.md), and the field/API mapping is in [docs/navidrome-mapping.md](docs/navidrome-mapping.md).

## Status

The initial implementation and mock integration suite are ready. It covers the API calls found in the currently audited Cloud Share source, including source authorization, search, song/album/artist/playlist details, recommendations, favorite status and updates, lyrics, cover art, and streaming. Live Cloud Share acceptance and a smoke test against your Navidrome remain to be run in your NAS environment.

## Docker deployment

1. Copy `.env.example` to `.env` and set the Navidrome address and a dedicated account. Give that account read access to the library and permission to star songs if favorites should work.
2. Generate `OMSP_TOKEN` as a long random value, for example `openssl rand -hex 32`.
3. If the NAS address Cloud Share should use differs from the container's host URL, set `PUBLIC_URL` to the URL the phone can reach. Behind a reverse proxy, set it to the external HTTPS URL. Configure the proxy to preserve the adapter base path or route it at `/`.
4. Start the service:

```sh
docker compose up -d --build
docker compose ps
```

The container listens on port 3000, runs as the unprivileged `node` user, has a read-only root filesystem, and includes a `/health` probe. The Docker base image supports `amd64` and `arm64`. To build for both architectures on a machine with Buildx:

```sh
docker buildx build --platform linux/amd64,linux/arm64 -t navidrome-omsp-adapter:latest .
```

Do not publish the adapter port to the public Internet without HTTPS and a strong OMSP token. A LAN or Tailscale-only route is a good fit for personal use.

## Environment

| Variable | Required | Purpose |
|---|---:|---|
| `NAVIDROME_URL` | Yes | Navidrome base URL, including an existing reverse-proxy prefix if present; HTTP and HTTPS are supported |
| `NAVIDROME_USERNAME` | Yes | Dedicated Navidrome username |
| `NAVIDROME_PASSWORD` | Yes | Password for that Navidrome account; never returned to Cloud Share |
| `OMSP_TOKEN` | Yes | Static bearer token configured in Cloud Share's data source |
| `PORT` | No | Adapter listen port; defaults to `3000` |
| `PUBLIC_URL` | No | Stable adapter origin for generated audio and cover URLs, useful behind proxies/Tailscale |
| `STREAM_MODE` | No | `redirect` by default; set to `proxy` if the player cannot follow Navidrome redirects |
| `EXPOSE_ALBUMS_IN_LIBRARY` | No | `false` by default; set to `true` to add virtual Navidrome albums to `/playlist/list` |
| `ALBUM_BROWSE_LIMIT` | No | Maximum number of albums scanned/listed when enabled; integer from `1` to `10000`, defaults to `2000` |
| `LOG_LEVEL` | No | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`; defaults to `info` |

Navidrome's credentials are sent to its API only, using Subsonic token authentication with a new random salt for every request (`t=md5(password + salt)`). Never put credentials in `NAVIDROME_URL`.

## Connect Cloud Share

In Cloud Share, add a data source with:

- Name: any label, such as `My Navidrome`
- Address: `http://NAS-IP:3000` (or the HTTPS/Tailscale URL from `PUBLIC_URL`)
- Token: the exact `OMSP_TOKEN` value

Press Next, enter the token, then confirm the source. The QR button is optional in Cloud Share's UI; this adapter intentionally does not invent a QR login for a static-token service. Restarting Cloud Share should retain the saved source and token.

The adapter accepts the `Token` request header used by Cloud Share and returns the OMSP response envelope. `/` reports `omsp-2026-0305` for compatibility with the current reference adapter. `/health` checks the Navidrome connection.

## HTTPS and Tailscale

For HTTPS, terminate TLS at the NAS reverse proxy and set `PUBLIC_URL=https://music-adapter.example.com`. Keep Navidrome reachable from the adapter over its internal URL; the phone does not need direct access to Navidrome while playback redirects are active, but it must reach the adapter.

For Tailscale, use the adapter machine's MagicDNS name in both `PUBLIC_URL` and the Cloud Share source address. Make sure the container can resolve/reach the Navidrome host over the network. Docker bridge DNS and host networking vary by NAS platform; use the address that works from inside a container.

## Playback and cover art

In the default `redirect` mode the adapter returns a per-song URL with a signed, expiring capability, then responds with HTTP 307 to Navidrome's stream endpoint. Navidrome receives Subsonic `u/t/s`; the password is never included in the media URL or sent to Cloud Share. The unique path filename avoids a filename collision in Cloud Share's current download/cache behavior. Audio bytes do not pass through the adapter.

Cover art uses a stable signed Adapter URL and is proxied on demand; it is not downloaded to persistent storage. The route tolerates Cloud Share appending its `?param=...` size hint.

### Browse albums from the library

Cloud Share's existing library playlist list can display Navidrome albums as virtual `type: album` items. Set `EXPOSE_ALBUMS_IN_LIBRARY=true`; each album is listed as `album:<Navidrome ID>` and opens through `/playlist/detail`, which returns its songs. The adapter fetches album pages from Navidrome and stops at `ALBUM_BROWSE_LIMIT` (default 2000, maximum 10000). This adds a manual browse-and-select path where the client exposes its library list. It does not change Cloud Share's home layout, recommendation cards, or automatic continuation/player UI; exact placement and selection behavior still depend on the installed client version.

Missing artwork uses a stable neutral SVG placeholder (`/media/placeholder/v1/{album,song,artist,playlist}.svg`) with an explicit image MIME type and cache policy, so the client always receives an image URL instead of retaining an unrelated prior image.

If playback fails because a client does not follow the redirect or a proxy blocks it, set `STREAM_MODE=proxy`. The adapter then passes through `Range`, `206 Partial Content`, `Content-Range`, `Content-Length`, `Content-Type`, and `Accept-Ranges`. The integration suite checks FLAC, MP3, and AAC response handling.

## Development and tests

```sh
npm ci
npm run typecheck
npm test
npm start
```

`npm test` builds and runs unit tests plus mock Navidrome integration tests. It covers randomized Subsonic authentication, hostile/special URL characters, OMSP auth and response fields, media signatures, lyric conversion, and Range handling.

To smoke test a real Navidrome, export the same environment variables as the service and run:

```sh
npm run test:navidrome
```

Optionally set `NAVIDROME_TEST_QUERY` to a term likely to match a song. The script exercises ping, login, search, playlist listing/detail when a playlist exists, song detail, a one-byte stream range request, cover art when present, and lyrics. It does not print credentials or full authenticated URLs.

## Troubleshooting

| Symptom | Check |
|---|---|
| Cloud Share returns 401 | The source Token must exactly match `OMSP_TOKEN`; check for whitespace/newlines and inspect `docker compose logs` without enabling HTTP query logging at the reverse proxy |
| `/health` is unhealthy or Cloud Share cannot connect | Verify `NAVIDROME_URL` from inside the container, reverse-proxy path, DNS, firewall, and Navidrome credentials with `npm run test:navidrome` |
| 403 from Navidrome | Check the dedicated Navidrome account and its permissions; the adapter reports only a sanitized error |
| Song will not play | Try the media URL from a device that can reach `PUBLIC_URL`; confirm Navidrome's `/rest/stream` works, then test `STREAM_MODE=proxy` |
| Cover art is missing | Verify the song/album has `coverArt`, set a reachable `PUBLIC_URL`, and check the proxy path and TLS certificate |
| Lyrics are empty | Lyrics are optional. Navidrome returns them only when available from embedded tags or supported sidecar files; older servers may not provide `getLyricsBySongId` |
| Seeking fails | Keep `STREAM_MODE=redirect` to let Navidrome handle byte ranges, or use `proxy` and verify the upstream supports Range requests |

## Scope notes

The exact Cloud Share APIs were taken from the checked-in Core/Community ArkTS client, not inferred from the incomplete OMSP Docs. Usernames/passwords are not a Cloud Share login option: Cloud Share requires a nonempty Token and validates it with `/connect/status`. QR login endpoints are called only after a user manually taps the optional QR button.
