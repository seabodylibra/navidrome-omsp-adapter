import { Album, Artist, Child, Playlist } from '../navidrome/types.js';

export interface OmspUser { id: string; name: string; avatar?: string; description?: string }
export interface OmspArtist { id: string; name: string; avatar?: string }
export interface OmspAlbum { id: string; name: string; cover?: string; artists: OmspArtist[]; size: number; description?: string }
export interface OmspSong {
  id: string; name: string; artists: OmspArtist[]; album: OmspAlbum; duration: number;
  privilege: { playable: boolean; reason?: string; bitrates?: number[]; maxBitrate?: number };
  meta?: { url?: string; bitrate?: number; size?: number; isFavorite?: boolean; lyric?: { normal?: string; translation?: string; transliteration?: string } };
}
export interface OmspPlaylist {
  id: string; name: string; cover?: string; size: number; creator: OmspUser; songs?: OmspSong[];
  type: 'normal' | 'album' | 'artist'; description?: string; meta?: { subscribed: boolean };
}

export const asArtist = (artist: Pick<Artist, 'id' | 'name' | 'coverArt'> | undefined,
  coverUrl: (id: string | undefined, type?: 'album' | 'song' | 'artist' | 'playlist') => string): OmspArtist => ({
  id: artist?.id ?? '', name: artist?.name ?? '', avatar: coverUrl(artist?.coverArt, 'artist'),
});

export function asAlbum(album: Album, coverUrl: (id: string | undefined, type?: 'album' | 'song' | 'artist' | 'playlist') => string): OmspAlbum {
  return {
    id: album.id, name: album.name, cover: coverUrl(album.coverArt, 'album'),
    artists: album.artist ? [{ id: album.artistId ?? '', name: album.artist }] : [],
    size: album.songCount ?? album.song?.length ?? 0,
  };
}

export function asSong(song: Child, coverUrl: (id: string | undefined, type?: 'album' | 'song' | 'artist' | 'playlist') => string, streamUrl: (song: Child) => string,
  isFavorite = false): OmspSong {
  const artist: OmspArtist = { id: song.artistId ?? '', name: song.artist ?? '' };
  const album: OmspAlbum = {
    id: song.albumId ?? '', name: song.album ?? '',
    cover: coverUrl(song.coverArt, 'song'), artists: artist.name ? [artist] : [], size: 0,
  };
  const suffix = song.suffix?.toLowerCase();
  const playable = !song.isVideo && (song.isDir !== true);
  const bitrates = song.bitRate ? [song.bitRate * 1000] : [];
  return {
    id: song.id, name: song.title, artists: artist.name ? [artist] : [], album,
    duration: Math.max(0, (song.duration ?? 0) * 1000),
    privilege: { playable, ...(playable ? {} : { reason: 'Unsupported media type' }), bitrates,
      ...(song.bitRate ? { maxBitrate: song.bitRate * 1000 } : {}) },
    meta: {
      url: streamUrl(song), ...(song.bitRate ? { bitrate: song.bitRate * 1000 } : {}),
      ...(song.size !== undefined ? { size: song.size } : {}), isFavorite,
    },
  };
}

export function asPlaylist(playlist: Playlist, coverUrl: (id: string | undefined, type?: 'album' | 'song' | 'artist' | 'playlist') => string): OmspPlaylist {
  return {
    id: playlist.id, name: playlist.name, cover: coverUrl(playlist.coverArt, 'playlist'),
    size: playlist.songCount ?? playlist.entry?.length ?? 0,
    creator: { id: playlist.owner ?? '', name: playlist.owner ?? '' }, type: 'normal',
    ...(playlist.comment ? { description: playlist.comment } : {}), meta: { subscribed: false },
  };
}
