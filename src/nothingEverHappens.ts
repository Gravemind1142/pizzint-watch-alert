const NOTHING_EVER_HAPPENS_URL = "https://www.pizzint.watch/api/neh-index/doomsday";
const SOMETHING_IS_HAPPENING_THRESHOLD = 0.65;
const SOMETHING_HAPPENED_THRESHOLD = 0.99;
const HYSTERESIS_BUFFER = 0.10;
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const HEIGHTENED_INTERVAL_MS = 1 * 60 * 1000; // 1 minute

// Track the threshold that triggered the alert for each market slug
let previousAlerts: Map<string, number> = new Map();

export interface NehMarket {
    slug: string;
    label: string;
    region: string;
    price: number; // 0.0 to 1.0 probability
    image?: string;
    // Add other fields if needed from exampleResponse.json
}

export interface NehResponse {
    markets: NehMarket[];
    timestamp: string;
}

export async function fetchNehData(): Promise<NehResponse> {
    const response = await fetch(NOTHING_EVER_HAPPENS_URL);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as NehResponse;
}

export function resetPreviousAlerts() {
    previousAlerts.clear();
}

/**
 * Determines which threshold, if any, the market currently meets.
 * Returns the highest threshold met, or 0 if none.
 */
function getMetThreshold(price: number): number {
    if (price >= SOMETHING_HAPPENED_THRESHOLD) return SOMETHING_HAPPENED_THRESHOLD;
    if (price >= SOMETHING_IS_HAPPENING_THRESHOLD) return SOMETHING_IS_HAPPENING_THRESHOLD;
    return 0;
}

/**
 * Checks the NEH index and sends alerts as needed.
 * Returns true if any market is in the heightened monitoring range
 * (above SOMETHING_IS_HAPPENING_THRESHOLD but below SOMETHING_HAPPENED_THRESHOLD),
 * which signals that we should poll more frequently.
 */
export async function checkAndAlert(): Promise<boolean> {
    console.log(`[${new Date().toISOString()}] Checking Nothing Ever Happens index...`);
    try {
        const data = await fetchNehData();
        const newAlerts: NehMarket[] = [];
        let hasHeightenedMarket = false;

        // 1. Process current markets
        for (const market of data.markets) {
            const currentThreshold = getMetThreshold(market.price);
            const previousThreshold = previousAlerts.get(market.slug);

            // Track whether any market is in the "something is happening" range
            if (market.price >= SOMETHING_IS_HAPPENING_THRESHOLD && market.price < SOMETHING_HAPPENED_THRESHOLD) {
                hasHeightenedMarket = true;
            }

            if (currentThreshold > 0) {
                // It is currently in an alertable state
                if (previousThreshold === undefined) {
                    // New alert
                    newAlerts.push(market);
                    previousAlerts.set(market.slug, currentThreshold);
                } else if (currentThreshold > previousThreshold) {
                    newAlerts.push(market);
                    previousAlerts.set(market.slug, currentThreshold);
                } else {
                    // The market is still above the base threshold, but hasn't exceeded the highest alerted threshold.
                    // We intentionally do not downgrade the tracked threshold. Retaining this high-water mark 
                    // prevents spamming redundant alerts if the price fluctuates back and forth across a higher 
                    // threshold (e.g., oscillating around 0.99) without first fully resetting via hysteresis.
                }
            } else {
                // Not meeting any threshold currently.
                // Check if we should clear the previous alert.
                if (previousThreshold !== undefined) {
                    if (market.price < (previousThreshold - HYSTERESIS_BUFFER)) {
                        console.log(`Clearing alert for ${market.slug} (Price: ${market.price} < ${previousThreshold} - ${HYSTERESIS_BUFFER})`);
                        previousAlerts.delete(market.slug);
                    }
                }
            }
        }

        // 2. Clean up markets that might have disappeared from the API response completely
        // (Optional, but good practice. If a slug is in previousAlerts but not in data.markets)
        const currentSlugs = new Set(data.markets.map(m => m.slug));
        for (const slug of previousAlerts.keys()) {
            if (!currentSlugs.has(slug)) {
                previousAlerts.delete(slug);
            }
        }

        // 3. Send Alerts
        if (newAlerts.length > 0) {
            console.log(`Detected ${newAlerts.length} new NEH events. Sending alert...`);
            await sendNehDiscordAlert(newAlerts);
        } else {
            console.log("No new NEH alerts.");
        }

        return hasHeightenedMarket;

    } catch (error) {
        console.error("Error checking NEH data:", error);
        return false;
    }
}

export async function sendNehDiscordAlert(markets: NehMarket[], webhookUrl?: string) {
    const url = webhookUrl || process.env.DISCORD_WEBHOOK_URL;
    if (!url) {
        console.error("DISCORD_WEBHOOK_URL is not set");
        return;
    }

    if (markets.length === 0) return;

    let messageBody = `# 🚨 **SOMETHING IS HAPPENING**\n`;
    messageBody += `**${markets.length}** event(s) monitoring active:\n\n`;

    for (const market of markets) {
        const thresholdMet = getMetThreshold(market.price);
        const icon = thresholdMet >= SOMETHING_HAPPENED_THRESHOLD ? "🔥" : "⚠️";
        const label = thresholdMet >= SOMETHING_HAPPENED_THRESHOLD ? "IT HAPPENED" : "HAPPENING";

        messageBody += `### ${icon} **${market.label}**\n`;
        messageBody += `> **Status:** ${label}\n`;
        messageBody += `> **Probability:** ${(market.price * 100).toFixed(1)}%\n`;
        messageBody += `> [View Market](https://polymarket.com/market/${market.slug})\n\n`; // Assuming slug link, verified from JSON potentially? JSON has `eventSlug` sometimes, or `slug`. `slug` usually works for polymarket.
    }

    messageBody += `_Checked at ${new Date().toISOString()}_`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: messageBody }),
        });

        if (!response.ok) {
            console.error(`Failed to send NEH webhook: ${response.status}`);
        } else {
            console.log("NEH alert sent successfully.");
        }
    } catch (error) {
        console.error("Error sending NEH webhook:", error);
    }
}

export function start() {
    async function scheduleNext() {
        const heightened = await checkAndAlert();
        const nextInterval = heightened ? HEIGHTENED_INTERVAL_MS : INTERVAL_MS;
        console.log(`Next NEH check in ${nextInterval / 1000 / 60} minute(s).`);
        setTimeout(scheduleNext, nextInterval);
    }

    // Start immediately
    scheduleNext();
}

