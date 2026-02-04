const NOTHING_EVER_HAPPENS_URL = "https://www.pizzint.watch/api/neh-index/doomsday";
const SOMETHING_IS_HAPPENING_THRESHOLD = 0.65;
const SOMETHING_HAPPENED_THRESHOLD = 0.99;
const HYSTERESIS_BUFFER = 0.10;

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

export async function checkAndAlert() {
    console.log(`[${new Date().toISOString()}] Checking Nothing Ever Happens index...`);
    try {
        const data = await fetchNehData();
        const newAlerts: NehMarket[] = [];

        // 1. Process current markets
        for (const market of data.markets) {
            const currentThreshold = getMetThreshold(market.price);
            const previousThreshold = previousAlerts.get(market.slug);

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
                    // Still alerting at same or lower threshold (but still above a threshold),
                    // so we just keep tracking it. Use max of prev and current?
                    // Actually, if it drops from 0.99 to 0.70 (still > 0.65), we probably shouldn't re-alert.
                    // Just keep the previous threshold or update to current?
                    // If we update to current (0.65), and it goes back to 0.99, we'd alert again. That seems correct.
                    // But if we just stay at 0.99 record, we won't alert again until it clears 0.99 logic.
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

    } catch (error) {
        console.error("Error checking NEH data:", error);
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
        messageBody += `> [View Market](https://polymarket.com/event/${market.slug})\n\n`; // Assuming slug link, verified from JSON potentially? JSON has `eventSlug` sometimes, or `slug`. `slug` usually works for polymarket.
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
