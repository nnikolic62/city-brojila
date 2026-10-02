"use client";

import { useCallback, useId, useRef, useState } from "react";
import type { ReadMeterResponse } from "@/lib/schema";

const MAX_PHOTOS = 15;

type PhotoItem = {
  id: string;
  file: File;
  preview: string;
};

/**
 * Minimalna stranica iz inicijalizacije: upload/slikanje → poziv API-ja → prikaz JSON-a.
 * Pravi UI (forma, statusi, potvrda) je PLAN.md faza 5.
 */
export default function Home() {
  const pickId = useId();
  const cameraId = useId();
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [result, setResult] = useState<ReadMeterResponse | null>(null);

  const revokePreview = useCallback((preview: string) => {
    URL.revokeObjectURL(preview);
  }, []);

  const addFiles = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      setResult(null);
      setElapsed(null);

      const incoming = Array.from(list).filter((f) => f.type.startsWith("image/") || f.type === "");
      if (incoming.length === 0) return;

      setPhotos((prev) => {
        const room = MAX_PHOTOS - prev.length;
        const slice = incoming.slice(0, Math.max(0, room));
        const next = [
          ...prev,
          ...slice.map((file) => ({
            id: crypto.randomUUID(),
            file,
            preview: URL.createObjectURL(file),
          })),
        ];
        return next;
      });
    },
    [],
  );

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const item = prev.find((p) => p.id === id);
      if (item) revokePreview(item.preview);
      return prev.filter((p) => p.id !== id);
    });
    setResult(null);
    setElapsed(null);
  }

  async function onSubmit() {
    if (photos.length === 0) return;
    setLoading(true);
    const t0 = performance.now();
    try {
      const body = new FormData();
      for (const p of photos) body.append("images", p.file);
      const res = await fetch("/api/read-meter", { method: "POST", body });
      setResult(await res.json());
    } catch {
      setResult({ status: "error", code: "NETWORK", message: "Greška u mreži." });
    } finally {
      setElapsed(Math.round(performance.now() - t0));
      setLoading(false);
    }
  }

  const atLimit = photos.length >= MAX_PHOTOS;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Čitač brojila</h1>

      <p className="text-sm text-zinc-600">
        Možete dodati više slika istog brojila (npr. serijski broj, VT i NT). Maksimum {MAX_PHOTOS} slika po
        slanju.
      </p>

      <div className="flex flex-wrap gap-3">
        <label
          htmlFor={pickId}
          className={`cursor-pointer rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:border-zinc-500 ${atLimit ? "pointer-events-none opacity-40" : ""}`}
        >
          Izaberi slike
        </label>
        <button
          type="button"
          disabled={atLimit}
          onClick={() => cameraRef.current?.click()}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:border-zinc-500 disabled:opacity-40"
        >
          Slikaj
        </button>
      </div>

      <input
        ref={pickRef}
        id={pickId}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        id={cameraId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {photos.length > 0 && (
        <ul className="flex flex-col gap-3">
          {photos.map((p, index) => (
            <li key={p.id} className="flex items-start gap-3 rounded-lg border border-zinc-200 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.preview}
                alt={`Pregled slike ${index + 1}`}
                className="h-24 w-24 shrink-0 rounded object-cover"
              />
              <div className="min-w-0 flex-1 pt-1">
                <p className="truncate text-sm font-medium">{p.file.name || `Slika ${index + 1}`}</p>
                <p className="text-xs text-zinc-500">{(p.file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button
                type="button"
                onClick={() => removePhoto(p.id)}
                className="shrink-0 rounded px-2 py-1 text-sm text-red-700 hover:bg-red-50"
              >
                Ukloni
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onSubmit}
        disabled={photos.length === 0 || loading}
        className="rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white disabled:opacity-40 dark:bg-white dark:text-zinc-900"
      >
        {loading ? "Čitam brojilo…" : photos.length <= 1 ? "Pošalji" : `Pošalji ${photos.length} slike`}
      </button>

      {elapsed !== null && <p className="text-sm text-zinc-500">Vreme: {(elapsed / 1000).toFixed(1)} s</p>}

      {result?.status === "error" && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          {result.message}
        </div>
      )}

      {result && (
        <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}
