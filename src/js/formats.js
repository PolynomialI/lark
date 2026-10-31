export const AUDIO_TYPES = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg; codecs=opus', wav: 'audio/wav', webm: 'audio/webm',
};
export const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
/** Guess artist/title from "Artist - Title.mp3" (optionally with a leading track number). */
export function fromFileName(name) {
  let base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  base = base.replace(/^\d{1,3}\s*[-.)]\s+/, '').replace(/^0\d\s+/, '');
  const i = base.indexOf(' - ');
  if (i > 0) return { artist: base.slice(0, i).trim(), title: base.slice(i + 3).trim() };
  return { artist: '', title: base };
}
