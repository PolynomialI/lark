// Origin Private File System: the audio files themselves, stored under /audio/<song id>.<ext>.
let dirp;
export const audioDir = () => (dirp ||= navigator.storage.getDirectory().then((r) => r.getDirectoryHandle('audio', { create: true })));

export async function getFile(name) {
  return (await (await audioDir()).getFileHandle(name)).getFile();
}
export async function hasFile(name) {
  try { await (await audioDir()).getFileHandle(name); return true; } catch { return false; }
}
/** Stream a Blob/File into OPFS without holding it in memory. */
export async function writeBlob(name, blob, onBytes) {
  const fh = await (await audioDir()).getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  if (!onBytes) return blob.stream().pipeTo(w);
  const counter = new TransformStream({ transform(chunk, c) { onBytes(chunk.byteLength); c.enqueue(chunk); } });
  return blob.stream().pipeThrough(counter).pipeTo(w);
}
export async function remove(name) {
  try { await (await audioDir()).removeEntry(name); } catch {}
}
export async function listNames() {
  const names = [];
  for await (const name of (await audioDir()).keys()) names.push(name);
  return names;
}
export async function clearAll() {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('audio', { recursive: true }); } catch {}
  dirp = null;
}
