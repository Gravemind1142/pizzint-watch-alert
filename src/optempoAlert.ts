import dotenv from "dotenv";
import { loadModuleState, saveModuleState } from "./statePersistence";

dotenv.config();

const COMMUTE_API_URL = "https://www.pizzint.watch/api/commute-index";
const ALERT_THRESHOLD = 4; // Alert if level <= 4
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const STATE_KEY = "optempoAlert";

interface OptempoAlertState {
    previousLevel: number;
}

// State to track previous level. Initialize to 5 (Business As Usual)
let previousLevel = 5;

export interface CommuteResponse {
    metro: {
        current: number;
        baseline: number;
        popularityRatio: number;
    };
    optempo: {
        color: string;
        label: string;
        level: number;
        value: number;
        summary: {
            corridorsTotal: number;
            dominantSignal: string;
            crossCorrelation: number;
            tier1AvgDeviation: number;
            tier2AvgDeviation: number;
            corridorsReporting: number;
        };
        timeWindow: {
            label: string;
            hourET: number;
            window: string;
            isWeekend: boolean;
            expectedRatio: number;
            sensitivityMultiplier: number;
        };
        description: string;
        rawDeviation: number;
    };
    success: boolean;
    timestamp: string;
}

export async function fetchCommuteData(): Promise<CommuteResponse> {
    const response = await fetch(COMMUTE_API_URL);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as CommuteResponse;
}

// Export for testing to reset state
export function resetPreviousLevel() {
    previousLevel = 5;
}

// Export for testing state verification
export function getPreviousLevel() {
    return previousLevel;
}

// Allow setting state for testing
export function setPreviousLevel(level: number) {
    previousLevel = level;
}

export async function checkAndAlertCommute() {
    try {
        const data = await fetchCommuteData();

        if (!data.success || !data.optempo) {
            console.error("Invalid Commute API response");
            return;
        }

        const currentLevel = data.optempo.level;

        // Logic:
        // 1. Alert if currentLevel <= ALERT_THRESHOLD (Severity check)
        // 2. AND currentLevel < previousLevel (Escalation check)
        const isEscalation = currentLevel < previousLevel;
        const isBadEnough = currentLevel <= ALERT_THRESHOLD;

        if (isEscalation && isBadEnough) {
            console.log(`Commute Alert: Level dropped from ${previousLevel} to ${currentLevel}`);
            await sendCommuteAlert(data);
        } else if (currentLevel > previousLevel) {
            console.log(`Commute Improved: Level rose from ${previousLevel} to ${currentLevel}`);
        } else {
            console.log("No abnormal commute activity detected.");
        }

        // Always update state to current level
        previousLevel = currentLevel;
        persistState();

    } catch (error) {
        console.error("Error checking commute alert:", error);
    }
}

export async function sendCommuteAlert(data: CommuteResponse, webhookUrl?: string) {
    const url = webhookUrl || process.env.DISCORD_WEBHOOK_URL;
    if (!url) {
        console.error("DISCORD_WEBHOOK_URL is not set");
        return;
    }

    const { optempo } = data;

    // Parse color string (e.g., "#22c55e") to integer for Discord if needed, 
    // or just rely on the side-bar color if using rich embeds.
    // For now, we will just use the text description as requested.

    let messageBody = `# 🚨 Pentagon Commute Alert: ${optempo.level} (${optempo.label})\n`;
    messageBody += `> **Time Window:** ${optempo.timeWindow.label}\n`;
    messageBody += `> **Description:** ${optempo.description}\n\n`;

    messageBody += `_Report generated at ${new Date().toISOString()} [Source](<https://www.pizzint.watch/>)_`;

    const content = {
        content: messageBody
    };

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(content),
        });

        if (!response.ok) {
            console.error(`Failed to send commute webhook: ${response.status} ${response.statusText}`);
        } else {
            console.log("Commute alert sent successfully.");
        }
    } catch (error) {
        console.error("Error sending commute webhook:", error);
    }
}

function persistState() {
    saveModuleState<OptempoAlertState>(STATE_KEY, { previousLevel });
}

export function start() {
    // Load persisted state
    const saved = loadModuleState<OptempoAlertState>(STATE_KEY);
    if (saved) {
        previousLevel = saved.previousLevel ?? 5;
    }

    // Start immediately
    checkAndAlertCommute();

    // Schedule
    setInterval(() => {
        checkAndAlertCommute();
    }, INTERVAL_MS);
}

