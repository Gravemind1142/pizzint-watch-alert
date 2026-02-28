import * as fs from "fs";
import * as path from "path";

const STATE_FILE = path.join(process.cwd(), "state.json");

/**
 * Loads the persisted state for a specific module key.
 * Returns undefined if the key doesn't exist or the file is missing/corrupt.
 */
export function loadModuleState<T>(key: string, filePath: string = STATE_FILE): T | undefined {
    try {
        if (!fs.existsSync(filePath)) {
            return undefined;
        }
        const raw = fs.readFileSync(filePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return parsed[key] as T | undefined;
    } catch (error) {
        console.error("Failed to load state file:", error);
        return undefined;
    }
}

/**
 * Saves a module's state under the given key, merging with existing state on disk.
 */
export function saveModuleState<T>(key: string, state: T, filePath: string = STATE_FILE): void {
    try {
        let existing: Record<string, unknown> = {};
        if (fs.existsSync(filePath)) {
            try {
                existing = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
            } catch {
                // Corrupt file — start fresh
            }
        }
        existing[key] = state;
        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
    } catch (error) {
        console.error("Failed to save state file:", error);
    }
}
