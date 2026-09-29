"use client";

import { useState } from "react";
import type { ReadMeterResponse } from "@/lib/schema";

/**
 * Minimalna stranica iz inicijalizacije: upload/slikanje → poziv API-ja → prikaz JSON-a.
 * Pravi UI (forma, statusi, potvrda) je PLAN.md faza 5.
 */
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [result, setResult] = useState<ReadMeterResponse | null>(null);

  function onPick(f: File | null) {
    setFile(f);
    setResult(null);
    setElapsed(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  async function onSubmit() {
    if (!file) return;
    setLoading(true);
    const t0 = performance.now();
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/read-meter", { method: "POST", body });
      setResult(await res.json());
    } catch {
      setResult({ status: "error", code: "NETWORK", message: "Greška u mreži." });
    } finally {
      setElapsed(Math.round(performance.now() - t0));
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Čitač brojila</h1>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 p-8 text-center hover:border-zinc-500">
        <span className="font-medium">Slikaj ili izaberi sliku brojila</span>
        <span className="text-sm text-zinc-500">Brojčanik neka popuni kadar, bez odsjaja</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </label>

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="Pregled slike brojila" className="max-h-80 w-full rounded-lg object-contain" />
      )}

      <button
        onClick={onSubmit}
        disabled={!file || loading}
        className="rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
      >
        {loading ? "Čitam brojilo…" : "Pošalji"}
      </button>

      {elapsed !== null && <p className="text-sm text-zinc-500">Vreme: {(elapsed / 1000).toFixed(1)} s</p>}

      {result && (
        <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
