import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const memesDir = path.join(rootDir, "client", "public", "assets", "audio", "memes");

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MEME_SOURCES = [
  {
    file: "aayein.mp3",
    pages: ["https://www.myinstants.com/instant/aayein-meme-98363/"],
  },
];

function extractMp3Url(html, baseUrl) {
  // Prefer the main instant button, download link, or structured metadata over related buttons
  const patterns = [
    /id=["']instant-page-button-element["'][^>]*?data-url=["']([^"']*\/media\/sounds\/[^"']+\.mp3)["']/i,
    /id=["']instant-page-button-element["'][^>]*?play\(\s*['"]([^'"]*\/media\/sounds\/[^'"]+\.mp3)['"]/i,
    /href=["']([^"']*\/media\/sounds\/[^"']+\.mp3)["'][^>]*download/i,
    /download[^>]*href=["']([^"']*\/media\/sounds\/[^"']+\.mp3)["']/i,
    /"contentUrl"\s*:\s*"([^"]*\/media\/sounds\/[^"]+\.mp3)"/i,
    /(\/media\/sounds\/[^"'\s<>\\)]+\.mp3)/i,
  ];

  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) {
      const raw = match[1].replace(/&amp;/g, "&");
      return new URL(raw, baseUrl).toString();
    }
  }
  return null;
}

function isLikelyMp3(buf) {
  if (buf.length < 3072) return false;
  // Reject HTML error pages
  const head = buf.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return false;

  // ID3v2 header ("ID3")
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  // MPEG audio frame sync (11 set bits: 0xFF followed by 0xE0..0xFF)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true;
  // Some MP3s have leading zero padding before sync/ID3
  for (let i = 0; i < Math.min(buf.length - 3, 512); i++) {
    if (buf[i] === 0x49 && buf[i + 1] === 0x44 && buf[i + 2] === 0x33) return true;
    if (buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0) return true;
  }
  return false;
}

async function fetchMeme({ file, pages }) {
  const destPath = path.join(memesDir, file);
  try {
    const stat = await fs.stat(destPath);
    if (stat.size > 3072) {
      const existing = await fs.readFile(destPath);
      if (isLikelyMp3(existing)) {
        console.log(`[skip] ${file} (${(stat.size / 1024).toFixed(1)} KB)`);
        return true;
      }
    }
  } catch {
    // not downloaded yet
  }

  let lastErr = null;
  for (const page of pages) {
    try {
      const pageRes = await fetch(page, { headers: HEADERS, redirect: "follow" });
      if (!pageRes.ok) {
        throw new Error(`Page HTTP ${pageRes.status} for ${page}`);
      }
      const html = await pageRes.text();
      const mp3Url = extractMp3Url(html, pageRes.url);
      if (!mp3Url) {
        throw new Error(`Could not find /media/sounds/*.mp3 on ${pageRes.url}`);
      }

      const audioRes = await fetch(mp3Url, {
        headers: {
          ...HEADERS,
          Accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
          Referer: pageRes.url,
        },
        redirect: "follow",
      });
      if (!audioRes.ok) {
        throw new Error(`Audio HTTP ${audioRes.status} for ${mp3Url}`);
      }

      const buf = Buffer.from(await audioRes.arrayBuffer());
      if (!isLikelyMp3(buf)) {
        throw new Error(
          `Downloaded data for ${file} is not a valid MP3 (${buf.length} bytes) from ${mp3Url}`
        );
      }

      await fs.writeFile(destPath, buf);
      console.log(`[ok]   ${file} (${(buf.length / 1024).toFixed(1)} KB) <- ${mp3Url}`);
      return true;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr ?? new Error(`Failed to fetch ${file}`);
}

async function main() {
  await fs.mkdir(memesDir, { recursive: true });
  console.log("=== Fetching Indian Meme Hit SFX (Myinstants) ===");

  let okCount = 0;
  for (const source of MEME_SOURCES) {
    try {
      const ok = await fetchMeme(source);
      if (ok) okCount++;
    } catch (err) {
      console.error(`[err]  ${source.file}: ${err.message}`);
    }
  }

  console.log(`\nFetched ${okCount}/${MEME_SOURCES.length} Indian meme MP3s into ${path.relative(rootDir, memesDir)}.`);
  if (okCount < MEME_SOURCES.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
