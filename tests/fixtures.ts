import type { MeterReading } from "@/lib/schema";

export function reading(overrides: Partial<MeterReading> = {}): MeterReading {
  return {
    isMeter: true,
    meterKind: "mechanical",
    tariffType: "dual",
    serialNumber: "12345678",
    readings: {
      single: null,
      vt: { integer: "045231", decimal: "7" },
      nt: { integer: "021877", decimal: "2" },
    },
    visibleTariff: null,
    imageQuality: { blur: false, glare: false, partial: false },
    confidence: { serialNumber: "high", readings: "high" },
    ...overrides,
  };
}
