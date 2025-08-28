import { promises as fsp } from "node:fs";
import path from "path";
import { NextResponse } from "next/server";

// Base directory from env or fallback
const BASE_DIR = process.env.BASE_DIR || "/home/pettrus/mcap_files";

export async function GET() {
  try {
    const absDir = path.resolve(BASE_DIR);

    // Read directory entries
    const entries = await fsp.readdir(absDir, { withFileTypes: true });

    // Build file info objects
    const mcapFiles = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".mcap"))
        .map(async (entry) => {
          const absPath = path.join(absDir, entry.name);
          const st = await fsp.stat(absPath);
          return {
            name: entry.name,
            size: st.size,                      // bytes
            createdAt: st.birthtime,            // creation time
            modifiedAt: st.mtime,               // last modified time
          };
        })
    );

    return NextResponse.json({
      dir: absDir,
      files: mcapFiles,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
