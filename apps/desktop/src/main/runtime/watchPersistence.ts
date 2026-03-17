import fs from "node:fs";
import path from "node:path";

export interface PersistedWatch {
  goal: string;
  startUrl?: string;
  intervalMinutes: number;
  lastExtractedData?: Array<{ label: string; value: string }>;
}

export async function saveWatches(filePath: string, watches: PersistedWatch[]): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(watches, null, 2), "utf-8");
  } catch (err) {
    console.error("[watchPersistence] Failed to save watches:", err);
  }
}

export async function loadWatches(filePath: string): Promise<PersistedWatch[]> {
  try {
    const data = await fs.promises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w: unknown): w is PersistedWatch =>
        typeof w === "object" &&
        w !== null &&
        typeof (w as PersistedWatch).goal === "string" &&
        typeof (w as PersistedWatch).intervalMinutes === "number"
    );
  } catch {
    return [];
  }
}
