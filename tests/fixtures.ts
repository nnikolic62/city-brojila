import type { MeterReading } from "@/lib/schema";

export function reading(overrides: Partial<MeterReading> = {}): MeterReading {
  return {
    isMeter: true,
    serialNumber: "12345678",
    manufacturer: "EWG",
    yearOfManufacture: "2020",
    obis: [
      { code: "1.8.1", value: "0452317" },
      { code: "1.8.2", value: "0218772" },
    ],
    ...overrides,
  };
}
