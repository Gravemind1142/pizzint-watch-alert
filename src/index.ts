import dotenv from "dotenv";

dotenv.config();

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const PIZZINT_URL = "https://www.pizzint.watch/api/dashboard-data?nocache=1";
const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_DOUGHCON = 2;

let previousSpikeIds: Set<string> = new Set();

interface PizzaPlace {
    place_id: string;
    name: string;
    address: string;
    current_popularity: number;
    is_spike: boolean;
    spike_magnitude: number | null;
    percentage_of_usual: number | null;
    recorded_at: string;
}

interface ApiResponse {
    success: boolean;
    data: PizzaPlace[];
    defcon_level: number;
}

async function checkAndAlert() {
    console.log(`[${new Date().toISOString()}] Checking for spikes...`);
    try {
        const response = await fetch(PIZZINT_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const json = (await response.json()) as ApiResponse;

        if (!json.success || !Array.isArray(json.data)) {
            console.error("Invalid API response format");
            return;
        }

        const currentSpikes = json.data.filter(place => place.is_spike);
        const currentSpikeIds = new Set(currentSpikes.map(p => p.place_id));

        // Filter for ONLY the new ones
        const newSpikes = currentSpikes.filter(place => !previousSpikeIds.has(place.place_id));

        const defcon_level = json.defcon_level || 5;

        if (newSpikes.length > 0 && defcon_level <= MIN_DOUGHCON) {
            console.log(`Defcon level is ${defcon_level}!!`);
            console.log(`Detected ${currentSpikes.length} total spikes. ${newSpikes.length} are new. Sending alert...`);
            await sendDiscordAlert(newSpikes, defcon_level);
        } else if (currentSpikes.length > 0) {
            console.log(`Detected ${currentSpikes.length} spikes, but all were already alerted. Skipping.`);
        } else {
            console.log("No spikes detected.");
        }

        // Update our state for next time
        // We overwrite the set completely so that if a spike STOPS happening, it's removed from the set.
        // That way if it comes back later, it will be treated as new again.
        previousSpikeIds = currentSpikeIds;

    } catch (error) {
        console.error("Error fetching data:", error);
    }
}

async function sendDiscordAlert(places: PizzaPlace[], defconLevel: number) {
    if (!DISCORD_WEBHOOK_URL) {
        console.error("DISCORD_WEBHOOK_URL is not set");
        return;
    }

    if (places.length === 0) return;

    const safeFormat = (value: any, suffix = "") =>
        (value !== null && value !== undefined) ? `${value}${suffix}` : "N/A";

    // Header
    let messageBody = `# 🚨 **Unusual traffic detected near the Pentagon!**\n`;
    messageBody += `**Doughcon:** ${defconLevel}\n`;
    messageBody += `**${places.length}** places currently showing spikes:\n\n`;

    // Process each place
    for (const place of places) {
        const mapLink = place.address ? `[Map](<${place.address}>)` : "No Address";
        const time = place.recorded_at ? new Date(place.recorded_at).toLocaleTimeString() : "Unknown Time";

        messageBody += `### 🍕 **${place.name || "Unknown Place"}**\n`;
        messageBody += `> **Popularity:** ${safeFormat(place.current_popularity, "%")} | **Spike:** ${safeFormat(place.spike_magnitude)} | **Normal:** ${safeFormat(place.percentage_of_usual, "%")}\n`;
        messageBody += `> 📍 ${mapLink} • 🕒 ${time}\n\n`;
    }

    messageBody += `_Report generated at ${new Date().toISOString()} [Source](<https://www.pizzint.watch/>)_`;

    const content = {
        content: messageBody
    };

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(content),
        });

        if (!response.ok) {
            console.error(`Failed to send webhook: ${response.status} ${response.statusText}`);
            const responseText = await response.text();
            console.error(`Response body: ${responseText}`);
        } else {
            console.log("Consolidated alert sent successfully.");
        }
    } catch (error) {
        console.error("Error sending webhook:", error);
    }
}

// Start immediately
checkAndAlert();
// sendMockAlert();

// Schedule every 15 minutes
setInterval(checkAndAlert, INTERVAL_MS);

console.log("node start done");

async function sendMockAlert() {
    const mockPlaces: PizzaPlace[] = [
        {
            place_id: "mock-id-123",
            name: "Joe's Pizza (Mock)",
            address: "https://goo.gl/maps/mockaddress",
            current_popularity: 85,
            is_spike: true,
            spike_magnitude: 30,
            percentage_of_usual: 150,
            recorded_at: new Date().toISOString(),
        },
        {
            place_id: "mock-id-456",
            name: "Luigi's Trattoria",
            address: "https://goo.gl/maps/mockaddress2",
            current_popularity: 92,
            is_spike: true,
            spike_magnitude: 45,
            percentage_of_usual: 200,
            recorded_at: new Date().toISOString(),
        }
    ];

    console.log("Sending mock alert...");
    await sendDiscordAlert(mockPlaces, 3);
}
