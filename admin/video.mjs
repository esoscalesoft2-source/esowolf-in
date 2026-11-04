/* Shrinks a video in the browser so it fits the site's 25 MB file limit (used when R2 storage is not connected).
   Uses Mediabunny (MPL-2.0, admin/vendor) on top of the browser's built-in WebCodecs encoder — nothing leaves the computer
   until the smaller file is ready. Loaded only when someone uploads a video. */
const LIMIT = 24 * 1024 * 1024;          // stay safely under Cloudflare Pages' 25 MiB per file
const AUDIO_BPS = 96_000;

export const SITE_LIMIT = LIMIT;

export async function compressVideo(file, onProgress = () => {}) {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser cannot compress videos. Please use the latest Google Chrome or Edge on a computer.");
  const MB = await import("./vendor/mediabunny-1.61.6.min.mjs");
  const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  if (!vt) throw new Error("No video found in this file.");
  const duration = await input.computeDuration();
  if (!(duration > 0)) throw new Error("Could not read the video length.");

  // how many bits per second fit into the limit (5% kept for the file's own overhead)
  let videoBps = Math.floor((LIMIT * 0.95 * 8) / duration) - AUDIO_BPS;
  if (videoBps < 300_000) {
    const maxMin = Math.floor(((LIMIT * 0.95 * 8) / (300_000 + AUDIO_BPS)) / 60);
    throw new Error(`This video is too long for site storage (about ${maxMin} minutes is the maximum). Please upload it to YouTube and paste the link instead.`);
  }
  videoBps = Math.min(videoBps, 2_500_000);   // more than this adds size without visible gain at 720p

  const w = vt.displayWidth, h = vt.displayHeight, long = Math.max(w, h);
  const target = videoBps < 700_000 ? 854 : 1280;   // low bitrate → smaller frame keeps it sharp
  const scale = Math.min(1, target / long);
  const size = h > w ? { height: even(h * scale) } : { width: even(w * scale) };

  // re-encode the sound to AAC when the browser can; otherwise copy the original sound as it is
  const audio = (await MB.canEncodeAudio("aac").catch(() => false)) ? { codec: "aac", bitrate: AUDIO_BPS } : {};

  for (let attempt = 0; attempt < 2; attempt++) {
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: "in-memory" }), target: new MB.BufferTarget() });
    const conv = await MB.Conversion.init({
      input, output,
      video: { ...size, codec: "avc", bitrate: videoBps, forceTranscode: true },
      audio
    });
    const lostSound = conv.discardedTracks.some(d => d.track && d.track.type === "audio");
    if (!conv.isValid) throw new Error("This browser cannot convert this video. Please try Google Chrome on a computer, or use YouTube.");
    conv.onProgress = p => onProgress(Math.min(0.999, p), attempt);
    await conv.execute();
    const blob = new Blob([output.target.buffer], { type: "video/mp4" });
    if (blob.size <= LIMIT) return { blob, lostSound, width: size.width || even(w * scale), height: size.height || even(h * scale) };
    videoBps = Math.floor(videoBps * (LIMIT / blob.size) * 0.9);   // encoder overshot — try once more, a bit lower
  }
  throw new Error("Could not make the video small enough. Please upload it to YouTube and paste the link instead.");
}
const even = n => Math.max(2, Math.round(n / 2) * 2);
