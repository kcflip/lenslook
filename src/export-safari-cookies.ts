// Reads ~/Library/Cookies/Cookies.binarycookies, filters by domain, and
// writes adorama-cookies.json (or bh-cookies.json) ready for injectCookies().
//
// Requires Full Disk Access for Terminal:
//   System Settings → Privacy & Security → Full Disk Access → add Terminal
//
// Usage:
//   npx tsx src/export-safari-cookies.ts [domain]
//   npx tsx src/export-safari-cookies.ts adorama.com
//   npx tsx src/export-safari-cookies.ts bhphotovideo.com

import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// Seconds between Unix epoch (1970-01-01) and Mac/CFAbsoluteTime epoch (2001-01-01).
const MAC_EPOCH_OFFSET = 978307200;

const FLAG_SECURE    = 0x1;
const FLAG_HTTP_ONLY = 0x4;

function readNullString(buf: Buffer, offset: number): string {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.toString("utf8", offset, end);
}

// Canonical record layout (verified against BinaryCookieReader.py):
//   0   uint32_le  record size
//   4   uint32_le  unknown
//   8   uint32_le  flags (Secure=0x1, HttpOnly=0x4)
//  12   uint32_le  unknown
//  16   uint32_le  domain string offset (from record start)
//  20   uint32_le  name string offset
//  24   uint32_le  path string offset
//  28   uint32_le  value string offset
//  32   uint32_le  comment/end marker
//  36   float64_le expiry (Mac epoch seconds)
//  44   float64_le creation (Mac epoch seconds)
//  52+             null-terminated strings
interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;   // Unix timestamp, -1 for session cookies
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

function extractCookies(filterDomain: string): PlaywrightCookie[] {
  const cookiesPath = join(homedir(), "Library", "Cookies", "Cookies.binarycookies");

  let buf: Buffer;
  try {
    buf = readFileSync(cookiesPath);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EACCES" || err.code === "EPERM" || err.code === "ENOENT") {
      console.error(`\n  ERROR: Cannot read ${cookiesPath}`);
      console.error(`\n  Safari cookies require Full Disk Access for Terminal:`);
      console.error(`  System Settings → Privacy & Security → Full Disk Access → add Terminal\n`);
    } else {
      console.error(`  ERROR reading cookies file: ${err.message}`);
    }
    process.exit(1);
  }

  const magic = buf.toString("ascii", 0, 4);
  if (magic !== "cook") {
    console.error(`  ERROR: Not a binary cookies file (magic bytes: ${JSON.stringify(magic)})`);
    process.exit(1);
  }

  const numPages = buf.readUInt32BE(4);
  const pageSizes: number[] = [];
  for (let i = 0; i < numPages; i++) {
    pageSizes.push(buf.readUInt32BE(8 + i * 4));
  }

  let pageStart = 8 + numPages * 4;
  const results: PlaywrightCookie[] = [];

  for (let p = 0; p < numPages; p++) {
    const page = buf.subarray(pageStart, pageStart + pageSizes[p]);
    pageStart += pageSizes[p];

    const pageMagic = page.readUInt32BE(0);
    if (pageMagic !== 0x00000100) continue;

    const numCookies = page.readUInt32LE(4);
    const cookieOffsets: number[] = [];
    for (let i = 0; i < numCookies; i++) {
      cookieOffsets.push(page.readUInt32LE(8 + i * 4));
    }

    for (const off of cookieOffsets) {
      if (off + 52 > page.length) continue;

      const flags      = page.readUInt32LE(off + 8);
      const domainOff  = page.readUInt32LE(off + 16);
      const nameOff    = page.readUInt32LE(off + 20);
      const pathOff    = page.readUInt32LE(off + 24);
      const valueOff   = page.readUInt32LE(off + 28);
      const expiryMac  = page.readDoubleLE(off + 36);

      const domain = readNullString(page, off + domainOff);

      // Match on suffix so ".adorama.com" and "adorama.com" both hit.
      if (!domain.endsWith(filterDomain) && !domain.endsWith(`.${filterDomain}`)) continue;

      const name    = readNullString(page, off + nameOff);
      const path    = readNullString(page, off + pathOff) || "/";
      const value   = readNullString(page, off + valueOff);
      const expires = expiryMac > 0 ? Math.round(expiryMac + MAC_EPOCH_OFFSET) : -1;

      results.push({
        name,
        value,
        domain,
        path,
        expires,
        httpOnly: (flags & FLAG_HTTP_ONLY) !== 0,
        secure:   (flags & FLAG_SECURE) !== 0,
        sameSite: "None",
      });
    }
  }

  return results;
}

function main() {
  const domain = process.argv[2] ?? "adorama.com";

  // Derive output filename from domain: adorama.com → adorama-cookies.json
  const slug = domain.replace(/^www\./, "").replace(/\..+$/, "");
  const outFile = `${slug}-cookies.json`;

  console.log(`\n  Extracting Safari cookies for ${domain}...\n`);

  const cookies = extractCookies(domain);

  if (cookies.length === 0) {
    console.log(`  No cookies found for ${domain}.`);
    console.log(`  Make sure you've visited the site in Safari recently.\n`);
    process.exit(0);
  }

  const nowSec = Date.now() / 1000;
  const WARN_SEC = 24 * 60 * 60;
  let anyExpired = false;

  for (const c of cookies) {
    if (c.expires === -1) {
      console.log(`  🍪 ${c.name} — session`);
    } else if (c.expires < nowSec) {
      console.log(`  🔴 ${c.name} — EXPIRED ${new Date(c.expires * 1000).toISOString()}`);
      anyExpired = true;
    } else if (c.expires - nowSec < WARN_SEC) {
      console.log(`  🟡 ${c.name} — expires soon ${new Date(c.expires * 1000).toISOString()}`);
    } else {
      console.log(`  🍪 ${c.name} — valid until ${new Date(c.expires * 1000).toISOString()}`);
    }
  }

  if (anyExpired) {
    console.log(`\n  ⚠️  Some cookies are expired — browse ${domain} in Safari first, then re-run.\n`);
  }

  writeFileSync(outFile, JSON.stringify(cookies, null, 2));
  console.log(`\n  ✓ wrote ${cookies.length} cookie${cookies.length === 1 ? "" : "s"} → ${outFile}\n`);
}

main();
