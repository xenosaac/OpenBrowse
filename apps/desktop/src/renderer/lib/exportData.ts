/**
 * Serialize extractedData arrays to JSON or CSV for file export.
 */

export type ExtractedDataItem = { label: string; value: string };

export function extractedDataToJson(data: ExtractedDataItem[]): string {
  return JSON.stringify(data, null, 2);
}

export function extractedDataToCsv(data: ExtractedDataItem[]): string {
  const escapeCsv = (s: string): string => {
    if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = "Label,Value";
  const rows = data.map((item) => `${escapeCsv(item.label)},${escapeCsv(item.value)}`);
  return [header, ...rows].join("\n");
}
