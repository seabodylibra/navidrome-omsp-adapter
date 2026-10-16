# Navidrome ↔ OMSP 映射

目标 Navidrome 为标准 OpenSubsonic/Subsonic REST API；本映射不依赖 Navidrome 数据库、文件系统或私有扫描逻辑。API base URL 可有反代前缀，例如 `https://music.example/subsonic`，末尾 `/` 会规范化。API query 由 URL/URLSearchParams 编码。

| OMSP endpoint | Navidrome 调用 | 字段转换 / 说明 |
|---|---|---|
| `GET /` | 无 | `{name:"omsp-2026-0305",version:"1.0.0"}`，贴近参考 Adapter 根响应 |
| `GET /health` | `GET /rest/ping` | 配置有效时状态 200；后端离线返回 503，不泄露凭据 |
| `GET /connect/status` | `GET /rest/getUser?username=<configured user>`，ping 作为连通验证 | `User.id=username`，`name=user.username`，`avatar/description` 可无。认证只认 OMSP `Token`，绝不把 Navidrome 密码返回 |
| `GET /playlist/list?uid` | `GET /rest/getPlaylists`；可选 `getAlbumList2?type=alphabeticalByName&size&offset` | 转为 OMSP Playlist，使用列表名、ID、封面、songCount、owner。设置 `EXPOSE_ALBUMS_IN_LIBRARY=true` 时追加 `type: album` 的 `album:<Navidrome ID>` 虚拟条目；`ALBUM_BROWSE_LIMIT` 限制扫描数量（默认 2000，范围 1–10000），按 500 条分页并去重。uid 是上游要求参数但不用于切换 Navidrome 用户 |
| `GET /playlist/detail?id` | `GET /rest/getPlaylist?id` | `entry[]` → `songs[]`；Subsonic playlist id 原样保留 |
| `GET /album/detail?id` | `GET /rest/getAlbum?id` | `song[]` → OMSP `songs[]`; album ID/name/cover/songCount、artist 映射到外层对象 |
| `GET /artist/detail?id` | `GET /rest/getArtist?id` | 每张 `album[]` 的 `song[]` 展平、去重成 `songs[]`；artist id/name/avatar 映射到 Playlist shape |
| `GET /search?keywords&limit` | `GET /rest/search3?query&songCount&albumCount&artistCount`，`playlistCount` 由 getPlaylists 本地过滤补充 | song/album/artist 取 Subsonic searchResult3，各自转换；Playlists 仅匹配已存在用户歌单名 |
| `GET /song/detail?id&br&uid` | `GET /rest/getSong?id` + `getLyricsBySongId?id` + `getStarred2`（详情所需字段按调用合并） | Song metadata 转 OMSP SongMeta；duration 秒→毫秒；播放地址用带歌 ID 的 Adapter URL，规避客户端同名缓存碰撞 |
| `GET /song/lyric?id`（扩展） | `GET /rest/getLyricsBySongId?id`，若未声明能力则 fallback `/rest/getLyrics?artist&title&album` | structuredLyrics.line(start ms,value) → LRC 行 `[mm:ss.xx] value`。空歌词返回空对象 |
| `PUT /song/like?id&like` | `GET /rest/star?id` / `GET /rest/unstar?id` | 以 `isFavorite` 查询结果同步处理重试；返回 `{id,like,playlist}`，favorite `playlist` 可用 starred 虚拟标识 |
| 播放地址 `meta.url` | `GET /rest/stream?id&maxBitRate` | 默认 Adapter 地址发出 307 重定向到 Navidrome；允许 `STREAM_MODE=proxy` 用流代理。proxy 转发 Range/206/Content-Range/Content-Length/Content-Type/Accept-Ranges |
| 图片地址 `album.cover` / `artist.avatar` / `playlist.cover` | `GET /rest/getCoverArt?id&size`；无 coverArt 时使用静态 placeholder 路由 | 使用 Adapter 有签名 URL 透明代理，传递客户端追加的 `param` hint 和 `If-None-Match`，响应 ETag/cache header。静态 SVG 占位图按实体类型验证路由、返回 `image/svg+xml` 并缓存一年；内容固定，不含用户输入。绝不把用户密码放进客户端 URL |
| 首屏 `/playlist/recommend?limit` | `GET /rest/getAlbumList2?type=random&size=N` | 随机专辑转 OMSP Playlist；Navidrome 无个性化推荐 |
| 首屏 `/song/recommend?limit` | `GET /rest/getRandomSongs?size=N` | 随机歌曲 |
| 首屏 `/artist/recommend?limit` | `GET /rest/getArtists` 后按 N 限制 | Navidrome 不提供个性化推荐艺人；稳定顺序子集 |
| 首屏 `/playlist/toplist?limit` | `GET /rest/getAlbumList2?type=frequent&size=N` | 以最常听专辑模拟榜单；`recent`、`newest` 也可用于扩展 |
| `/song/scrobble?id&time`（扩展） | `GET /rest/scrobble?id&time` | 标注播放器来源；客户端当前没有 OMSP scrobble 调用 |

## Subsonic 参数和封套

使用 `f=json`、`v=1.16.1`、`c=navidrome-omsp-adapter`。密码认证模块每次请求生成不可预测 salt、计算 `md5(password + salt)`，并提供无明文密码参数。若 Navidrome API Key 可配置，应优先 API key（OpenSubsonic extension），否则使用标准 `u/t/s`。Basic Auth 只应作为 Navidrome 管理明确打开时的兼容选择，不作为默认。

Navidrome 响应在 `subsonic-response` 中，检查 `status === "ok"`，服务端错误转换为稳定的 OMSP error。常用实体：

- Subsonic `Child.id`, `title`, `artist`, `artistId`, `album`, `albumId`, `coverArt`, `duration`, `bitRate`, `suffix`, `size`, `path`, `isDir`, `isVideo`, `type`。
- ArtistID3: `id`, `name`, `albumCount`, `coverArt`, `album[]`。
- AlbumID3: `id`, `name`, `artist`, `artistId`, `coverArt`, `songCount`, `song[]`。
- Playlist: `id`, `name`, `comment`, `owner`, `songCount`, `coverArt`, `entry[]`。
- Starred2: `song[]` 的 ID 用于喜欢状态；列表规模较大时仅对单曲状态查询/缓存，不应每首重复拉完整库。

## 播放、seek 与兼容性

Cloud Share 实际把 `meta.url` 交给系统下载器，它会用播放 URL 最后一段路径作为本地文件名，然后至少下载 10% 才开始本地播放。若所有媒体 URL 最后一段都是 `stream`，本地缓存文件名会冲突。故使用 `/media/stream/<song-id>/<name>.<suffix>?sig=...` 形式，URL path 最终包含可读的文件名；不需要存储音频，也不做全量转发。默认 307 的 HTTP Range 由 Navidrome 直接处理，客户端须能跟随重定向。若反代/客户端不兼容，可设 `STREAM_MODE=proxy`，此时 Adapter 要保留字节范围和响应头。封面代理负责追加 query 后的稳定访问。

音频签名包含资源类型、Navidrome item ID 和有效期，并由 OMSP token 衍生 HMAC key 验证；客户端不会拿到 Navidrome 密码、Subsonic `t/s` 或 API key。代理 URL 包含有限时 capability，设计失效时间需覆盖用户打开详情到完整播放/下载的时长，并对重复请求使用同 URL。部署时 `PUBLIC_URL` 应填写 Cloud Share 能从设备访问的 Adapter origin（含反向代理 base path），否则 URL host 依据请求 Host 生成；只信任正确配置的反代 `X-Forwarded-*`。

## 暂缓能力

OpenSubsonic `getLyricsBySongId`、star/unstar、scrobble、albumList2 random/recent/frequent/newest 适合作为映射能力。类似排行榜、推荐均为近似体验，不宣称等同第三方平台推荐。歌单创建/编辑、订阅专辑、歌手推荐个性化、在线播放队列不在当前 Cloud Share 网络调用范围内。
