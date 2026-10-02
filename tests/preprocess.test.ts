import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { cropRegion, orientImage } from "@/lib/preprocess";

async function solidPng(
  width: number,
  height: number,
  background: { r: number; g: number; b: number },
): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
}

describe("cropRegion", () => {
  it("vraća očekivane dimenzije za region u procentima", async () => {
    const input = await solidPng(100, 200, { r: 255, g: 0, b: 0 });
    const cropped = await cropRegion(input, { top: 0, left: 0, width: 1, height: 0.5 });
    const meta = await sharp(cropped).metadata();
    expect(meta.width).toBe(100);
    expect(meta.height).toBe(100);
  });

  it("zaokružuje procente na cele piksele", async () => {
    const input = await solidPng(101, 101, { r: 0, g: 255, b: 0 });
    const cropped = await cropRegion(input, { top: 0, left: 0, width: 1, height: 0.5 });
    const meta = await sharp(cropped).metadata();
    expect(meta.width).toBe(101);
    expect(meta.height).toBe(Math.round(101 * 0.5));
  });

  it("ne izlazi van slike kad region prelazi ivicu", async () => {
    const input = await solidPng(100, 100, { r: 0, g: 0, b: 255 });
    const cropped = await cropRegion(input, { top: 0.6, left: 0.2, width: 1, height: 0.6 });
    const meta = await sharp(cropped).metadata();
    expect(meta.width).toBe(80);
    expect(meta.height).toBe(40);
  });
});

describe("orientImage", () => {
  it("primenjuje EXIF rotaciju na punoj rezoluciji i čita capturedAt", async () => {
    const input = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { DateTime: "2024:03:15 10:20:30" } },
      })
      .toBuffer();

    const result = await orientImage(input);
    expect(result.width).toBe(20);
    expect(result.height).toBe(40);
    expect(result.capturedAt).toBe(new Date("2024-03-15T10:20:30").toISOString());
  });
});
