"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

// helpers
function formatBytes(bytes) {
  if (bytes === 0 || bytes == null) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const p = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = (bytes / Math.pow(1024, p)).toFixed(p === 0 ? 0 : 1);
  return `${v} ${units[p]}`;
}

function formatDate(d) {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function HomePage() {
  const [files, setFiles] = useState([]);      // [{ name, size, createdAt, modifiedAt }]
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const disableDownload = loading || selected.size === 0;

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  // Load file list on mount
  useEffect(() => {
    async function loadFiles() {
      setError("");
      try {
        const res = await fetch(`${API_URL}/api/files/`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch files");
        setFiles(data.files || []);
        setSelected(new Set()); // clear selection on refresh
      } catch (e) {
        setError(e.message);
      }
    }
    loadFiles();
  }, []);

  function toggle(name) {
    const next = new Set(selected);
    next.has(name) ? next.delete(name) : next.add(name);
    setSelected(next);
  }

  const allSelected = useMemo(
    () => files.length > 0 && files.every((f) => selected.has(f.name)),
    [files, selected]
  );

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.name)));
    }
  }

  async function handleDownload() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_URL}/api/recover-and-zip/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Server uses BASE_DIR, so we only send names
        body: JSON.stringify({ files: Array.from(selected) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `recovered_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-0 pb-8 px-8 font-sans">
      <div className="mx-auto w-full max-w-4xl">
                {/* KSU Header */}
        <div className="text-center mb-8 mt-0">
          <div className="flex items-center justify-center mb-0">
            <Image 
              src="/ksu-logo.webp" 
              alt="Kennesaw State University" 
              width={800} 
              height={240}
              className="h-96 w-auto"
              priority
            />
          </div>
          <h1 className="text-3xl font-bold text-black -mt-30 mb-0">MCAP Data Recovery System</h1>
          <p className="text-lg text-gray-700 mb-4">
            Kennesaw Motorsports - Data Offload Gizmo
          </p>
          <div className="w-24 h-1 bg-yellow-400 mx-auto rounded-full"></div>
        </div>
        
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-black mb-3">File Selection</h2>
          <p className="text-sm text-gray-600 mb-4">
            Select MCAP files to recover and download as a ZIP archive.
          </p>

          {error && (
            <div className="mb-4 rounded-md bg-red-100 p-3 text-red-700 border border-red-200">
              <div className="flex items-center">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            </div>
          )}

        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-3">
              <input
                id="select-all"
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-yellow-500 focus:ring-yellow-500 focus:ring-2"
                checked={allSelected}
                onChange={toggleAll}
                disabled={files.length === 0}
              />
              <label htmlFor="select-all" className="text-sm font-medium text-gray-700">
                {allSelected ? "Unselect all" : "Select all"}
              </label>
            </div>
            <div className="text-sm text-gray-600 font-medium">
              {selected.size} file{selected.size !== 1 ? 's' : ''} selected
            </div>
          </div>

          <ul className="divide-y divide-gray-200">
            {files.length === 0 && (
              <li className="p-6 text-center text-gray-500">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm">No .mcap files found in the directory.</p>
              </li>
            )}

            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  checked={selected.has(f.name)}
                  onChange={() => toggle(f.name)}
                  className="h-4 w-4 rounded border-gray-300 text-yellow-500 focus:ring-yellow-500 focus:ring-2"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <svg className="w-5 h-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                      </svg>
                      <span className="truncate font-medium text-gray-800">{f.name}</span>
                    </div>
                    <span className="shrink-0 text-sm text-gray-600 font-medium">{formatBytes(f.size)}</span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-x-4">
                    <span title={String(f.createdAt)} className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                      </svg>
                      Created: {formatDate(f.createdAt)}
                    </span>
                    <span title={String(f.modifiedAt)} className="flex items-center gap-1">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                      Modified: {formatDate(f.modifiedAt)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-lg p-6">
          <button
            onClick={handleDownload}
            disabled={disableDownload}
            className={`w-full rounded-lg px-6 py-4 text-white font-semibold text-lg transition-all duration-200 transform ${
              disableDownload 
                ? "bg-gray-400 cursor-not-allowed" 
                : "bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"
            }`}
          >
            {loading ? (
              <div className="flex items-center justify-center gap-3">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing Recovery...
              </div>
            ) : (
              <div className="flex items-center justify-center gap-3">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download Recovered Files
              </div>
            )}
          </button>
          
          {selected.size > 0 && (
            <p className="text-center text-sm text-gray-600 mt-3">
              {selected.size} file{selected.size !== 1 ? 's' : ''} will be processed and recovered
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
