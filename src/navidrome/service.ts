import { Config } from '../config.js';
import { signMedia } from '../media-signature.js';
import { asAlbum, asArtist, asPlaylist, asSong, OmspAlbum, OmspArtist, OmspPlaylist, OmspSong, OmspUser } from '../omsp/models.js';
import { Album, Artist, Child, Playlist, StructuredLyric } from './types.js';
import { NavidromeClient } from './client.js';

type PublicBase = () => URL;
export class MusicService {
  private starsCache: { until: number; ids: Set<string> } | undefined;
  private recommendationsCache: { until: number; value: Awaited<ReturnType<MusicService['fetchRecommendations']>> } | undefined;
  private recommendationsFlight: Promise<Awaited<ReturnType<MusicService['fetchRecommendations']>>> | undefined;
  constructor(private readonly client: NavidromeClient, private readonly config: Config, private readonly publicBase: PublicBase) {}

  coverUrl(id: string | undefined, type: 'album' | 'song' | 'artist' | 'playlist' = 'album'): string {
    if (!id) return new URL(`media/placeholder/v1/${type}.svg`, this.publicBase()).toString();
    const { expires, sig } = signMedia(this.config.omspToken, 'cover', id);
    // Cloud Share appends "?param=..." literally, so keep capability fields in the path.
    return new URL(`media/cover/${encodeURIComponent(id)}/${expires}/${sig}`, this.publicBase()).toString();
  }
  streamUrl(song: Child): string {
    const suffix = /^[a-z0-9]{1,8}$/i.test(song.suffix ?? '') ? song.suffix!.toLowerCase() : 'audio';
    const name = `${(song.title || 'track').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80)}.${suffix}`;
    const { expires, sig } = signMedia(this.config.omspToken, 'stream', song.id);
    return new URL(`media/stream/${encodeURIComponent(song.id)}/${encodeURIComponent(name)}?e=${expires}&s=${sig}`, this.publicBase()).toString();
  }

  async user(): Promise<OmspUser> {
    const data = await this.client.call<{ user?: { username?: string; email?: string; scrobblingEnabled?: boolean } }>('getUser', { username: this.config.username });
    const user = data.user;
    return { id: this.config.username, name: user?.username ?? this.config.username };
  }
  async ping(): Promise<void> { await this.client.call('ping'); }

  async playlists(limit = 1000): Promise<OmspPlaylist[]> {
    const data = await this.client.call<{ playlists?: { playlist?: Playlist[] } }>('getPlaylists', { username: this.config.username });
    const playlists = (data.playlists?.playlist ?? []).slice(0, limit).map(item => asPlaylist(item, (id, type) => this.coverUrl(id, type)));
    const stars = await this.favoriteIds();
    const result: OmspPlaylist[] = [{ id: 'starred', name: '喜欢的歌曲', cover: this.coverUrl(undefined, 'playlist'), size: stars.size,
      creator: { id: this.config.username, name: this.config.username }, type: 'normal' }, ...playlists];
    if (this.config.exposeAlbumsInLibrary) result.push(...(await this.browseableAlbums()));
    return result;
  }

  private async browseableAlbums(): Promise<OmspPlaylist[]> {
    const albums = new Map<string, Album>();
    let offset = 0;
    const pageSize = 500;
    while (offset < this.config.albumBrowseLimit) {
      const size = Math.min(pageSize, this.config.albumBrowseLimit - offset);
      const data = await this.client.call<{ albumList2?: { album?: Album[] } }>('getAlbumList2', {
        type: 'alphabeticalByName', size, offset,
      });
      const page = data.albumList2?.album ?? [];
      for (const album of page) {
        if (albums.size >= this.config.albumBrowseLimit) break;
        if (album.id && !albums.has(album.id)) albums.set(album.id, album);
      }
      offset += page.length;
      if (page.length < size || page.length === 0) break;
    }
    return [...albums.values()].map(album => ({
      id: `album:${album.id}`, name: album.name, cover: this.coverUrl(album.coverArt, 'album'),
      size: album.songCount ?? 0, creator: { id: album.artistId ?? '', name: album.artist ?? '' },
      type: 'album', meta: { subscribed: false },
    }));
  }
  async playlistDetail(id: string): Promise<OmspPlaylist> {
    if (id.startsWith('album:')) {
      const album = await this.albumDetail(id.slice('album:'.length));
      return { ...album, id };
    }
    if (id.startsWith('artist:')) {
      const artist = await this.artistDetail(id.slice('artist:'.length));
      return { ...artist, id };
    }
    if (id === 'starred') {
      const data = await this.client.call<{ starred2?: { song?: Child[] } }>('getStarred2');
      const songs = data.starred2?.song ?? [];
      return {
        id: 'starred', name: '喜欢的歌曲', size: songs.length,
        creator: { id: this.config.username, name: this.config.username }, type: 'normal',
        songs: songs.map(song => asSong(song, (key, type) => this.coverUrl(key, type), item => this.streamUrl(item), true)),
      };
    }
    const data = await this.client.call<{ playlist?: Playlist }>('getPlaylist', { id });
    if (!data.playlist) throw new Error('Playlist not found');
    const playlist = asPlaylist(data.playlist, (key, type) => this.coverUrl(key, type));
    playlist.songs = (data.playlist.entry ?? []).filter(item => !item.isDir).map(item => asSong(item, (key, type) => this.coverUrl(key, type), song => this.streamUrl(song)));
    return playlist;
  }
  async albumDetail(id: string): Promise<OmspPlaylist> {
    const data = await this.client.call<{ album?: Album }>('getAlbum', { id });
    if (!data.album) throw new Error('Album not found');
    const album = data.album;
    return {
      id: album.id, name: album.name, size: album.songCount ?? album.song?.length ?? 0,
      cover: this.coverUrl(album.coverArt, 'album'), creator: { id: album.artistId ?? '', name: album.artist ?? '' },
      type: 'album', meta: { subscribed: false },
      songs: (album.song ?? []).map(item => asSong(item, (key, type) => this.coverUrl(key, type), song => this.streamUrl(song))),
    };
  }
  async artistDetail(id: string): Promise<OmspPlaylist> {
    const data = await this.client.call<{ artist?: Artist }>('getArtist', { id });
    if (!data.artist) throw new Error('Artist not found');
    const artist = data.artist; const albums = artist.album ?? [];
    const songs = new Map<string, Child>();
    await Promise.all(albums.map(async album => {
      if (album.song) { album.song.forEach(song => songs.set(song.id, song)); return; }
      const result = await this.client.call<{ album?: Album }>('getAlbum', { id: album.id });
      (result.album?.song ?? []).forEach(song => songs.set(song.id, song));
    }));
    return {
      id: artist.id, name: artist.name, size: songs.size,
      cover: this.coverUrl(artist.coverArt, 'artist'), creator: { id: artist.id, name: artist.name },
      type: 'artist', meta: { subscribed: false },
      songs: [...songs.values()].map(song => asSong(song, (cover, type) => this.coverUrl(cover, type), item => this.streamUrl(item))),
    };
  }
  async search(query: string, limit: number): Promise<{ songs: OmspSong[]; albums: OmspAlbum[]; artists: OmspArtist[]; playlists: OmspPlaylist[] }> {
    const count = Math.min(Math.max(limit, 1), 100);
    const data = await this.client.call<{ searchResult3?: { song?: Child[]; album?: Album[]; artist?: Artist[] } }>('search3', {
      query, songCount: count, albumCount: count, artistCount: count, songOffset: 0, albumOffset: 0, artistOffset: 0,
    });
    const [playlists] = await Promise.all([this.playlists()]);
    const lowered = query.toLocaleLowerCase();
    return {
      songs: (data.searchResult3?.song ?? []).map(song => asSong(song, (id, type) => this.coverUrl(id, type), item => this.streamUrl(item))),
      albums: (data.searchResult3?.album ?? []).map(album => asAlbum(album, (id, type) => this.coverUrl(id, type))),
      artists: (data.searchResult3?.artist ?? []).map(artist => asArtist(artist, (id, type) => this.coverUrl(id, type))),
      playlists: playlists.filter(playlist => playlist.name.toLocaleLowerCase().includes(lowered)).slice(0, count),
    };
  }
  async songDetail(id: string): Promise<OmspSong> {
    const [data, ids] = await Promise.all([this.client.call<{ song?: Child }>('getSong', { id }), this.favoriteIds()]);
    if (!data.song) throw new Error('Song not found');
    const song = asSong(data.song, (key, type) => this.coverUrl(key, type), item => this.streamUrl(item), ids.has(id));
    try {
      const lyrics = await this.client.call<{ lyricsList?: { structuredLyrics?: StructuredLyric[] } }>('getLyricsBySongId', { id });
      const lyric = lyrics.lyricsList?.structuredLyrics?.find(item => item.line?.length);
      if (lyric && song.meta) song.meta.lyric = { normal: toLrc(lyric) };
    } catch { /* No lyrics or older Navidrome without songLyrics extension is normal. */ }
    if (!song.meta?.lyric?.normal) {
      try {
        const lyric = await this.client.call<{ lyrics?: { value?: string } }>('getLyrics', {
          artist: data.song.artist, title: data.song.title,
        });
        if (lyric.lyrics?.value && song.meta) song.meta.lyric = { normal: lyric.lyrics.value };
      } catch { /* Missing lyrics are not a song-detail failure. */ }
    }
    return song;
  }
  async setFavorite(id: string, like: boolean): Promise<void> {
    await this.client.call(like ? 'star' : 'unstar', { id });
    this.starsCache = undefined;
  }
  async favoriteIds(): Promise<Set<string>> {
    if (this.starsCache && this.starsCache.until > Date.now()) return this.starsCache.ids;
    try {
      const data = await this.client.call<{ starred2?: { song?: Child[] } }>('getStarred2');
      const ids = new Set((data.starred2?.song ?? []).map(song => song.id));
      this.starsCache = { until: Date.now() + 30_000, ids };
      return ids;
    } catch { return new Set(); }
  }
  async recommendations(limit: number): Promise<{ playlists: OmspPlaylist[]; songs: OmspSong[]; artists: OmspArtist[]; toplist: OmspPlaylist[] }> {
    if (this.recommendationsCache && this.recommendationsCache.until > Date.now()) return this.recommendationsCache.value;
    if (!this.recommendationsFlight) {
      this.recommendationsFlight = this.fetchRecommendations(limit).then(value => {
        this.recommendationsCache = { until: Date.now() + 15_000, value };
        return value;
      }).finally(() => { this.recommendationsFlight = undefined; });
    }
    return this.recommendationsFlight;
  }

  private async fetchRecommendations(limit: number): Promise<{ playlists: OmspPlaylist[]; songs: OmspSong[]; artists: OmspArtist[]; toplist: OmspPlaylist[] }> {
    const size = Math.min(Math.max(limit, 1), 50);
    const [albumData, songData, artistData, frequent] = await Promise.all([
      this.client.call<{ albumList2?: { album?: Album[] } }>('getAlbumList2', { type: 'random', size }),
      this.client.call<{ randomSongs?: { song?: Child[] } }>('getRandomSongs', { size }),
      this.client.call<{ artists?: { index?: Array<{ artist?: Artist[] }> } }>('getArtists'),
      this.client.call<{ albumList2?: { album?: Album[] } }>('getAlbumList2', { type: 'frequent', size }),
    ]);
    const albumPlaylist = (album: Album): OmspPlaylist => ({ id: `album:${album.id}`, name: album.name, cover: this.coverUrl(album.coverArt, 'album'), size: album.songCount ?? 0, creator: { id: album.artistId ?? '', name: album.artist ?? '' }, type: 'album' });
    const flatArtists = (artistData.artists?.index ?? []).flatMap(item => item.artist ?? []);
    return {
      playlists: (albumData.albumList2?.album ?? []).map(albumPlaylist),
      songs: (songData.randomSongs?.song ?? []).map(song => asSong(song, (id, type) => this.coverUrl(id, type), item => this.streamUrl(item))),
      artists: flatArtists.slice(0, size).map(artist => asArtist(artist, (id, type) => this.coverUrl(id, type))),
      toplist: (frequent.albumList2?.album ?? []).map(albumPlaylist),
    };
  }
  async newest(limit: number): Promise<OmspPlaylist[]> {
    const data = await this.client.call<{ albumList2?: { album?: Album[] } }>('getAlbumList2', { type: 'newest', size: Math.min(limit, 100) });
    return (data.albumList2?.album ?? []).map(album => ({ id: `album:${album.id}`, name: album.name, cover: this.coverUrl(album.coverArt, 'album'), size: album.songCount ?? 0, creator: { id: album.artistId ?? '', name: album.artist ?? '' }, type: 'album' }));
  }
  async scrobble(id: string, time: number): Promise<void> { await this.client.call('scrobble', { id, time, submission: true }); }
}

export function toLrc(lyric: StructuredLyric): string {
  return (lyric.line ?? []).filter(line => typeof line.value === 'string')
    .map(line => {
      if (!lyric.synced || !Number.isFinite(line.start)) return line.value ?? '';
      const centiseconds = Math.max(0, Math.floor(((line.start ?? 0) - (lyric.offset ?? 0)) / 10));
      const minutes = Math.floor(centiseconds / 6000); const seconds = Math.floor(centiseconds / 100) % 60;
      const fraction = String(centiseconds % 100).padStart(2, '0');
      return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${fraction}]${line.value}`;
    }).join('\n');
}
