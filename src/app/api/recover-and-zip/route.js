// app/api/recover-and-zip/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { promises as fsp } from "node:fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import NodeZip from "node-zip"; // npm i node-zip

// --- Config (set in .env.local for real usage) ---
const BASE_DIR = process.env.BASE_DIR || "/home/nixos/recordings"; // absolute
const SCRIPT_PATH = process.env.SCRIPT_PATH || "/home/nixos/recordings/mcap_recover.sh"; // absolute
const TMP_ROOT = process.env.TMP_DIR || os.tmpdir();

const MAX_FILES = Number(process.env.MAX_FILES || 200);
const MAX_TOTAL_BYTES = Number(
  process.env.MAX_TOTAL_BYTES || 5 * 1024 * 1024 * 1024
); // 5GB

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resolveInside(base, rel = ".") {
  const baseAbs = path.resolve(base);
  const abs = path.resolve(baseAbs, rel);
  if (abs !== baseAbs && !abs.startsWith(baseAbs + path.sep)) {
    throw new Error("Path traversal detected");
  }
  return abs;
}

async function stageSelected(absDir, fileNames, inputDir) {
  let total = 0;
  for (const name of fileNames) {
    const src = resolveInside(absDir, name);
    const st = await fsp.stat(src);
    if (!st.isFile()) throw new Error(`Not a file: ${name}`);
    total += st.size;
    const dest = path.join(inputDir, path.basename(name));
    await fsp.copyFile(src, dest);
  }
  return total;
}

function runScriptOnce(onDir, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(SCRIPT_PATH, [onDir], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) =>
      reject(new Error(`Failed to start script: ${err.message}`))
    );

    child.on("close", (code, signal) => {
      if (code === 0) return resolve();
      reject(
        new Error(
          `Recovery script exited with code ${code}${
            signal ? ` (signal ${signal})` : ""
          }. ${stderr}`
        )
      );
    });
  });
}

export async function POST(request) {
  // Parse body: we accept { files: string[] }
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }
  const { files } = body || {};
  if (!Array.isArray(files) || files.length === 0) {
    return json(400, { error: "Expected { files: string[] }" });
  }
  if (files.length > MAX_FILES) {
    return json(400, { error: `Too many files selected (max ${MAX_FILES})` });
  }

  // Prepare temp workspace
  const jobId = randomUUID();
  const workRoot = path.join(TMP_ROOT, `recoverjob-${jobId}`);
  const inputDir = path.join(workRoot, "input");

  try {
    await fsp.mkdir(inputDir, { recursive: true });
  } catch {
    return json(500, { error: "Failed to prepare temp workspace" });
  }

  // Stage selected files from BASE_DIR into temp/input
  try {
    const total = await stageSelected(
      resolveInside(BASE_DIR, "."),
      files,
      inputDir
    );
    if (total > MAX_TOTAL_BYTES) {
      await fsp.rm(workRoot, { recursive: true, force: true });
      return json(400, {
        error: `Selection too large (>${(MAX_TOTAL_BYTES / 1024 ** 3).toFixed(
          1
        )} GB)`,
      });
    }
  } catch (e) {
    await fsp.rm(workRoot, { recursive: true, force: true });
    return json(400, { error: e.message || "Failed to stage selected files" });
  }

  // Run the bash recovery script ON THE TEMP INPUT DIRECTORY
  try {
    await runScriptOnce(inputDir, { cwd: workRoot });
  } catch (e) {
    await fsp.rm(workRoot, { recursive: true, force: true });
    return json(500, { error: "Recovery script failed", details: e.message });
  }

  // Build ZIP in-memory with node-zip (reads all files into memory)
  // NOTE: node-zip is not streaming; for very large sets consider a streaming lib.
  try {
    const entries = await fsp.readdir(inputDir, { withFileTypes: true });
    const recovered = entries
      .filter((e) => e.isFile() && e.name.endsWith(".mcap"))
      .map((e) => e.name);

    if (recovered.length === 0) {
      await fsp.rm(workRoot, { recursive: true, force: true });
      return json(400, { error: "No recovered .mcap files were produced" });
    }

    const zip = new NodeZip();
    for (const name of recovered) {
      const abs = path.join(inputDir, name);
      const data = await fsp.readFile(abs); // Buffer
      // node-zip expects string/binary; pass binary string + { binary: true }
      zip.file(name, data.toString("binary"), {
        binary: true,
        compression: "DEFLATE",
      });
    }

    const zipBinary = zip.generate({ base64: false, compression: "DEFLATE" });
    const zipBuffer = Buffer.from(zipBinary, "binary");

    // Cleanup before sending (to be safe even if client disconnects later)
    await fsp.rm(workRoot, { recursive: true, force: true });

    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
    headers.set(
      "Content-Disposition",
      `attachment; filename="recovered_${new Date()
        .toISOString()
        .replace(/[:.]/g, "-")}.zip"`
    );

    return new Response(zipBuffer, { headers });
  } catch (e) {
    // Best-effort cleanup
    await fsp.rm(workRoot, { recursive: true, force: true }).catch(() => {});
    return json(500, { error: "Failed to build ZIP", details: e.message });
  }
}
