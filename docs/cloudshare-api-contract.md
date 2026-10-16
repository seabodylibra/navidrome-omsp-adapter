# Cloud Share 当前源码的 OMSP 接口契约

## 审计范围与版本

本契约按 `docs/upstream-lock.json` 中锁定的 Cloud Share `Core`、`Community`、`Community_OH` 与 `NeteaseMusicAdapter` 源码整理。ArkTS 客户端是行为依据；Docs 用作辅助；QMusicAdapter 用于交叉验证。上游没有版本标签发布，因此锁定 Git commit，而不是宣称覆盖未来源码。

核心客户端：`Core/entry/src/main/ets/adapter/index.ets`、`type/Adapter.ets`、`view/Setting.ets`、`view/Playlist.ets`、`view/Playing.ets`、`util/EventHelper.ets`、`util/SongDownloadManager.ets`。Community 和 Community_OH 的适配器请求基本相同。网络候选扫描见 `network-audit.md`。

## 启动、添加与授权顺序

1. 客户端启动后，从持久化的数据源配置逐一请求数据源 `GET /connect/status`；请求头含 `Token` 和 `Client: EdgeMusic-<版本号>`。启动页随后调用 `GET /playlist/recommend?limit=20`、`GET /song/recommend?limit=20`、`GET /artist/recommend?limit=20`、`GET /playlist/toplist?limit=20`、`GET /playlist/list?uid=<用户ID>`。这些推荐端点失败会被吞掉并呈空结果。
2. 新增来源时，第一页只输入名称、地址、描述；点击“下一步”只切换表单，不发网络请求。来源根路径 `/` **没有被 ArkTS 数据源客户端请求**。参考适配器 `NeteaseMusicAdapter` 的 `/` 返回 `{ "name":"omsp-2026-0305", "version":"1.0.0" }`，这是建议的服务发现兼容项，不是客户端强制检查。
3. 第二页允许在 Token 文本框直接输入任意非空 token；点击确认后请求 `GET /connect/status`，验证成功后持久化数据源并拉取上述首页资源。没有用户名/密码登录方式，也没有独立的账号密码认证表单。
4. 二维码区域是可选的“获取二维码”按钮。只有用户点击时，客户端才依次请求 `/connect/qr/key`、`/connect/qr/create?key=...`，之后每 3 秒轮询 `/connect/qr/check?key=...`。成功态 `status=2` 时将 `cookie` 自动填入同一 Token 字段。二维码不是强制流程；允许静态 Token。Adapter 可以提供虚拟 QR 作为 UX 帮助，但不能要求用户走它。本实现选择不提供伪二维码。
5. 后续所有 API 请求都传 `Token` header；客户端 `Content-Type: application/json`。数据源地址中的 query 参数会被 Axios 作为每个请求的默认 query 原样附带。没有客户端请求体。`X-Cache: true` 仅用于歌单、专辑、艺人详情；客户端本地缓存提示，不代表服务端响应缓存义务。

## 响应封套与通用规则

绝大多数客户端请求按 `{ code:number, message:string, data:T, timestamp:number }` 解包 `data`。成功码必须是 `0`。失败应使用非零 `code` 和可读 `message`；调用首页推荐/搜索/详情的若干路径会捕获失败并退化为空内容，但 `/connect/status` 失败会阻止保存来源。

时间戳示例有毫秒数字与 ISO 字符串差异；ArkTS 只声明 `number` 但不读取该字段。建议返回毫秒 Unix 时间戳。错误封套也应保持同形状；避免把 Navidrome 原始错误、凭据或完整 URL 返回客户端。

## 实际请求清单

| Method | OMSP URL / query | Header | Body | `data` 响应形状与必需字段 | 可选/说明 |
|---|---|---|---|---|---|
| GET | `/` | 无已见客户端要求 | 无 | 无客户端要求。兼容发现响应为 `{name,version}`，根对象 | 参考 Adapter 的 name 为 `omsp-2026-0305` |
| GET | `/health` | 无 | 无 | 无 OMSP 客户端直接请求证据 | 运维探针，不做 Token 门控 |
| GET | `/connect/status` | `Token` 必需；`Client` | 无 | `User {id,name}` | `avatar`,`description` 可选。成功才添加/恢复来源 |
| GET | `/connect/qr/key` | `Token` header 会带空字符串或既有值；`Client` | 无 | `{unikey}` | **用户点击二维码按钮才请求**；本实现可返回功能未启用错误 |
| GET | `/connect/qr/create?key=...` | 同上 | 无 | `{qrurl,qrimg}` | `qrimg` 客户端没有传 `qrimg=true`，UI 直接显示 `qrimg` |
| GET | `/connect/qr/check?key=...` | 同上 | 无 | `{status,cookie}` | status: -1,0,1,2；客户端只从 2 状态取 cookie |
| GET | `/playlist/recommend?limit=N` | `Token`,`Client` | 无 | `Playlist[]` | 首页立即请求；失败则空 |
| GET | `/song/recommend?limit=N` | 同上 | 无 | `Song[]` | 首页立即请求；失败则空 |
| GET | `/artist/recommend?limit=N` | 同上 | 无 | `Artist[]` | 首页立即请求；失败则空 |
| GET | `/playlist/toplist?limit=N` | 同上 | 无 | `Playlist[]` | 首页立即请求；失败则空 |
| GET | `/playlist/list?uid=ID` | 同上 | 无 | `Playlist[]` | 启动和资料库页请求；uid 来自已验证 User.id |
| GET | `/playlist/detail?id=ID&limit=5000` | `Token`,`Client`,`X-Cache:true/false` | 无 | `Playlist {songs: Song[]}` | songs 缺失客户端会转为空数组；建议返回完整列表、`meta` 可选 |
| GET | `/album/detail?id=ID` | `Token`,`Client`,`X-Cache:true` | 无 | `{songs: Song[], meta?}` | 客户端构造 Playlist 展示，不要求详情中重复 album 外层对象 |
| GET | `/artist/detail?id=ID` | `Token`,`Client`,`X-Cache:true` | 无 | `Playlist {songs: Song[]}` | detail 的 `data` 原样返回；至少 songs 数组，id/name 推荐提供 |
| GET | `/song/detail?id=ID&br=BITRATE[&uid=ID]` | `Token`,`Client` | 无 | `Song {id, meta?}` | 客户端合并 `meta` 到已有歌曲。`br` 默认为所选码率；`uid` 可选且只在源 User 有 id 时出现 |
| GET | `/search?keywords=TEXT&limit=N` | `Token`,`Client` | 无 | `{songs:Song[],playlists:Playlist[],artists:Artist[],albums:Album[]}` | 每个数组都应存在；无结果用空数组。keywords 由客户端 `encodeURIComponent` 后放 query |
| PUT | `/song/like?id=ID&like=true\|false` | `Token`,`Client` | 无 | `{playlist:ID}` | 客户端只取 `data.playlist` 并刷新用户歌单；返回 `{id,like}` 可附加 |

Query 参数全部通过客户端 URL 字符串或 Axios params 发送；adapter 应按标准 URL query 解析，不能假定参数次序。`id` 在类型上允许 string 或 number。客户端未在适配器层直接调用 `/song/lyric`、`/stream`、`/cover`、`/scrobble`：播放与封面是把返回 URL 交给系统播放器/图片组件直接下载，因此这类地址的访问能力属于端到端契约。

## 实际读取的实体字段

| 实体 | 客户端会读取/依赖的字段 |
|---|---|
| User | `id`（用于 `/playlist/list?uid=`）、`name`；`avatar`,`description` 有 UI 空值回退 |
| Song | `id`,`name`,`artists[]`,`album`,`duration`（毫秒）、`privilege.playable`（用于禁用播放）、可选 `privilege.reason`,`bitrates`,`maxBitrate`、`tns`；detail 将 `meta` 附到原 Song |
| Song.meta | `url`（必需：下载器用它下载/播放且依 URL 文件名缓存）、`size`（缺省会提示不能 seek）、`bitrate`,`isFavorite`,`lyric.normal`；`md5` 可保留 |
| Album | `id`,`name`,`cover`,`artists[]`,`size`,`description`；封面被 UI helper 追加 `?param=<尺寸>` |
| Artist | `id`,`name`,`avatar`；打开详情时传 `id` |
| Playlist | `id`,`name`,`cover`,`size`,`creator.name`,`songs[]`,`type`,`description`,`meta.subscribed`；客户端会对全部用户歌单请求详情 |
| Lyric | 当前播放及系统媒体元数据实际使用 `Song.meta.lyric.normal` LRC。结构中的 `translation`、`transliteration` 有定义但播放流程没有保证使用 |

可直接确认 `Song.duration` 使用播放器毫秒时长；Navidrome 的秒数必须乘 1000。封面在 Playing/Playlist 等 UI 中通过 `cover(url,size)` 追加 query，故有签名的封面 URL 需容忍其被加上额外参数。

## 未实现后的影响与 MVP 数量

进入首页需要 1 个必需认证 endpoint 与 5 个首次加载 endpoint（推荐歌曲、歌单、艺人、排行榜、用户歌单），共 **6 个客户端 API endpoint**；5 个推荐列表可安全为空，但 `/connect/status` 不能缺失。进入 P0 的搜索、歌曲、专辑/艺人/歌单详情、收藏需要额外 6 个被客户端直接调用的 endpoint，合计 **12 个必需/安全可降级的客户端 API endpoint**。另实现独立歌词路由可作为扩展，但客户端当前不单独请求它；歌曲详情应直接返回 `meta.lyric.normal`。封面和播放由歌曲/实体响应中的 URL 触发，不额外算 OMSP 请求。

首页推荐端点可以返回空数组而不导致客户端异常；`playlist/list` 返回空意味着资料库歌单为空。详情方法吞错并打开空歌曲列表，但无法显示目标实体歌曲。`/search` 缺少某一数组会被 `?.` 容忍，仍建议 4 数组齐全。`song/detail` 即便失败也可能继续使用原 Song，但没有 `meta.url` 就无法播放；没有 `meta.lyric.normal` 只表示无歌词，不应破坏播放。缺少喜欢 API 会使收藏操作失败且 UI 乐观更新；启动 `/connect/status` 缺失或错误会导致数据源无法添加/恢复。

## 取舍 / 证据边界

- 用户所说的“Cloud Share”按 Edge-Music Cloud Share / 云享社理解。
- Core 源码由公开源码确认；UI 还有图片请求与音频下载，但这些由系统原生组件处理，未经过 `SourceAdapter` 的 Axios 拦截器。
- QR 能否省略有直接证据：UI 的二维码单独按钮与 Token 文本框分开，确认按钮只要求非空 Token 并调用 status。
- 当前公开代码没有可见版本 API 探测调用。根信息端点仍为低成本兼容项。
- 不存在检索到的现成 Navidrome OMSP Adapter；本轮组织仓库枚举和 GitHub 仓库搜索均没有结果。
