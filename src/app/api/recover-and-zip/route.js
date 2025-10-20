// app/api/recover-and-zip/route.js
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { promises as fsp } from "node:fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import archiver from "archiver";

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


function runScriptOnce(onDir, selectedFiles, { cwd }) {
  return new Promise((resolve, reject) => {
    // Invoke via 'sh' so the mounted script need not be executable on host
    // Pass directory and selected filenames as arguments
    const args = [SCRIPT_PATH, onDir, ...selectedFiles];
    const child = spawn("sh", args, {
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

  // Create simple temp workspace
  const jobId = randomUUID();
  const workRoot = path.join(TMP_ROOT, `recoverjob-${jobId}`);

  try {
    await fsp.mkdir(workRoot, { recursive: true });
    
    // Copy selected files directly to temp directory
    let totalSize = 0;
    for (const fileName of files) {
      const srcPath = path.join(BASE_DIR, fileName);
      const dstPath = path.join(workRoot, fileName);
      
      const stats = await fsp.stat(srcPath);
      if (!stats.isFile()) {
        throw new Error(`Not a file: ${fileName}`);
      }
      
      totalSize += stats.size;
      await fsp.copyFile(srcPath, dstPath);
    }
    
    if (totalSize > MAX_TOTAL_BYTES) {
      await fsp.rm(workRoot, { recursive: true, force: true });
      return json(400, {
        error: `Selection too large (>${(MAX_TOTAL_BYTES / 1024 ** 3).toFixed(1)} GB)`,
      });
    }
  } catch (e) {
    await fsp.rm(workRoot, { recursive: true, force: true });
    return json(400, { error: e.message || "Failed to copy selected files" });
  }

  // Run the recovery script on the temp directory with selected files
  try {
    await runScriptOnce(workRoot, files, { cwd: workRoot });
    
    // Add a small delay to ensure all files are written
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Verify files exist after recovery
    const postRecoveryEntries = await fsp.readdir(workRoot, { withFileTypes: true });
    const recoveredFiles = postRecoveryEntries
      .filter((e) => e.isFile() && e.name.endsWith("-rec.mcap"))
      .map((e) => e.name);
    
    console.log(`Recovery completed. Found ${recoveredFiles.length} recovered files:`, recoveredFiles);
  } catch (e) {
    await fsp.rm(workRoot, { recursive: true, force: true });
    return json(500, { error: "Recovery script failed", details: e.message });
  }

  // Build ZIP using streaming archiver (memory efficient)
  try {
    const entries = await fsp.readdir(workRoot, { withFileTypes: true });
    
    // Only zip the files that were actually created by the recovery script
    // These are the files that correspond to the user's selected files
    const recoveredFiles = [];
    
    for (const fileName of files) {
      // For each selected file, find its corresponding recovered version
      const baseName = fileName.replace(/\.mcap$/, ''); // Remove .mcap extension
      const recoveredName = `${baseName}-rec.mcap`;
      
      // Check if the recovered file exists
      const recoveredPath = path.join(workRoot, recoveredName);
      try {
        const stats = await fsp.stat(recoveredPath);
        if (stats.isFile()) {
          recoveredFiles.push(recoveredName);
          console.log(`Found recovered file: ${recoveredName} (${stats.size} bytes)`);
        } else {
          console.error(`Recovered file is not a file: ${recoveredName}`);
        }
      } catch (err) {
        console.error(`Recovered file not found: ${recoveredName}`, err);
      }
    }

    if (recoveredFiles.length === 0) {
      await fsp.rm(workRoot, { recursive: true, force: true });
      return json(400, { error: "No recovered .mcap files were produced" });
    }

    console.log(`Zipping ${recoveredFiles.length} recovered files:`, recoveredFiles);

    // Use streaming approach for large files to avoid memory issues
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD format
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS format
    const zipFileName = `recovered_${dateStr}_${timeStr}_${recoveredFiles.length}files.zip`;
    
    // Create streaming ZIP response
    const stream = new ReadableStream({
      start(controller) {
        const archive = archiver('zip', { zlib: { level: 1 } }); // Lower compression for speed
        
        archive.on('error', (err) => {
          console.error('Archive error:', err);
          controller.error(err);
        });

        archive.on('end', () => {
          console.log('Archive finalized successfully');
          controller.close();
        });

        archive.on('data', (chunk) => {
          controller.enqueue(chunk);
        });

        // Add files to archive
        (async () => {
          try {
            for (const fileName of recoveredFiles) {
              const filePath = path.join(workRoot, fileName);
              try {
                const stats = await fsp.stat(filePath);
                if (stats.isFile()) {
                  archive.file(filePath, { name: fileName });
                  console.log(`Added to archive: ${fileName} (${stats.size} bytes)`);
                } else {
                  throw new Error(`Not a file: ${fileName}`);
                }
              } catch (fileErr) {
                console.error(`File error: ${filePath}`, fileErr);
                controller.error(new Error(`File error: ${fileName}`));
                return;
              }
            }
            
            // Finalize the archive
            await archive.finalize();
          } catch (err) {
            console.error('Archive creation error:', err);
            controller.error(err);
          }
        })();
      }
    });

    // Cleanup after response is sent
    setTimeout(async () => {
      await fsp.rm(workRoot, { recursive: true, force: true }).catch(() => {});
    }, 10000); // Increased delay for large files

    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFileName}"`
        // Don't set Content-Length for streaming responses
      }
    });
  } catch (e) {
    // Best-effort cleanup
    await fsp.rm(workRoot, { recursive: true, force: true }).catch(() => {});
    return json(500, { error: "Failed to build ZIP", details: e.message });
  }
}
