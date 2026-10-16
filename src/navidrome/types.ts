export interface SubsonicEnvelope<T = unknown> {
  'subsonic-response'?: { status: 'ok' | 'failed'; version?: string; error?: { code?: number; message?: string }; [key: string]: unknown } & T;
}
export interface Child {
  id: string; parent?: string; title: string; isDir?: boolean; album?: string; albumId?: string; artist?: string; artistId?: string;
  coverArt?: string; duration?: number; bitRate?: number; suffix?: string; size?: number; contentType?: string;
  isVideo?: boolean; created?: string; starred?: string; type?: string;
}
export interface Artist { id: string; name: string; coverArt?: string; albumCount?: number; album?: Album[] }
export interface Album { id: string; name: string; artist?: string; artistId?: string; coverArt?: string; songCount?: number; song?: Child[]; created?: string }
export interface Playlist { id: string; name: string; comment?: string; owner?: string; songCount?: number; coverArt?: string; entry?: Child[] }
export interface StructuredLyric { lang?: string; synced?: boolean; offset?: number; line?: Array<{ start?: number; value?: string }> }
