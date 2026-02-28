import { checkAndAlert, resetPreviousAlerts } from './nothingEverHappens';
import { NehResponse } from './nothingEverHappens';

// Mock the global fetch
global.fetch = jest.fn();

describe('nothingEverHappens', () => {
    const MOCK_WEBHOOK_URL = "https://discord.com/api/webhooks/123/abc";

    beforeEach(() => {
        jest.clearAllMocks();
        resetPreviousAlerts();
        process.env.DISCORD_WEBHOOK_URL = MOCK_WEBHOOK_URL;
    });

    const mockApiResponse = (markets: any[]): Promise<Response> => {
        const response: NehResponse = {
            markets: markets,
            timestamp: new Date().toISOString()
        };
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(response)
        } as Response);
    };

    it('should alert when a market exceeds the threshold', async () => {
        (global.fetch as jest.Mock)
            .mockImplementationOnce(() => mockApiResponse([
                { slug: 'market-1', label: 'Market 1', price: 0.70 } // > 0.65
            ])) // for fetchNehData
            .mockImplementationOnce(() => Promise.resolve({ ok: true } as Response)); // for sendNehDiscordAlert (webhook)

        const result = await checkAndAlert();
        expect(result).toBe(true); // 0.70 is in the heightened range

        // Expect fetch to be called for data and webhook
        expect(global.fetch).toHaveBeenCalledTimes(2);

        // Check webhook call
        const webhookCall = (global.fetch as jest.Mock).mock.calls[1];
        expect(webhookCall[0]).toBe(MOCK_WEBHOOK_URL);
        const body = JSON.parse(webhookCall[1].body);
        expect(body.content).toContain("Market 1");
        expect(body.content).toContain("HAPPENING");
    });

    it('should batch multiple alerts', async () => {
        (global.fetch as jest.Mock)
            .mockImplementationOnce(() => mockApiResponse([
                { slug: 'market-batch-1', label: 'Market Batch 1', price: 0.70 },
                { slug: 'market-batch-2', label: 'Market Batch 2', price: 0.80 }
            ]))
            .mockImplementationOnce(() => Promise.resolve({ ok: true } as Response));

        const result = await checkAndAlert();

        expect(result).toBe(true); // Both markets in heightened range
        expect(global.fetch).toHaveBeenCalledTimes(2);
        const webhookCall = (global.fetch as jest.Mock).mock.calls[1];
        const body = JSON.parse(webhookCall[1].body);
        expect(body.content).toContain("Market Batch 1");
        expect(body.content).toContain("Market Batch 2");
        expect(body.content).toContain("2** event(s)");
    });

    it('should not alert again for the same market if price stays high', async () => {
        // First run: 0.70 -> Alert
        (global.fetch as jest.Mock)
            .mockReturnValueOnce(mockApiResponse([{ slug: 'market-dedup-1', label: 'Market Dedup 1', price: 0.70 }]))
            .mockReturnValueOnce(Promise.resolve({ ok: true } as Response));

        await checkAndAlert();
        expect(global.fetch).toHaveBeenCalledTimes(2); // 1 fetch + 1 webhook

        jest.clearAllMocks();

        // Second run: 0.75 -> No Alert (already alerted)
        (global.fetch as jest.Mock)
            .mockReturnValueOnce(mockApiResponse([{ slug: 'market-dedup-1', label: 'Market Dedup 1', price: 0.75 }]));

        await checkAndAlert();
        // Should fetch data but NOT send webhook
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should escalate alert if it crosses the higher threshold', async () => {
        // First run: 0.70 -> Alert
        (global.fetch as jest.Mock)
            .mockReturnValueOnce(mockApiResponse([{ slug: 'market-escalate-1', label: 'Market Escalate 1', price: 0.70 }]))
            .mockReturnValueOnce(Promise.resolve({ ok: true } as Response));

        await checkAndAlert();

        jest.clearAllMocks();

        // Second run: 0.99 -> Alert (Escalation)
        (global.fetch as jest.Mock)
            .mockReturnValueOnce(mockApiResponse([{ slug: 'market-escalate-1', label: 'Market Escalate 1', price: 0.99 }]))
            .mockReturnValueOnce(Promise.resolve({ ok: true } as Response));

        const result = await checkAndAlert();
        expect(result).toBe(false); // 0.99 is at SOMETHING_HAPPENED_THRESHOLD, not in heightened range
        expect(global.fetch).toHaveBeenCalledTimes(2); // Should alert again
        const webhookCall = (global.fetch as jest.Mock).mock.calls[1];
        const body = JSON.parse(webhookCall[1].body);
        expect(body.content).toContain("IT HAPPENED");
    });

    it('should clear alert only when price drops below hysteresis buffer', async () => {
        // 1. Initial Alert at 0.70 (Threshold 0.65)
        (global.fetch as jest.Mock).mockReturnValueOnce(mockApiResponse([{ slug: 'm-hyst-1', label: 'M Hyst 1', price: 0.70 }]))
            .mockReturnValueOnce(Promise.resolve({ ok: true }));
        await checkAndAlert();
        expect(global.fetch).toHaveBeenCalledTimes(2);

        jest.clearAllMocks();

        // 2. Drop to 0.60 (0.65 - 0.05). Should NOT clear. 0.60 > (0.65 - 0.10 = 0.55)
        (global.fetch as jest.Mock).mockReturnValueOnce(mockApiResponse([{ slug: 'm-hyst-1', label: 'M Hyst 1', price: 0.60 }]));
        await checkAndAlert();
        expect(global.fetch).toHaveBeenCalledTimes(1); // Fetch only, no alert

        jest.clearAllMocks();

        // 3. Rise to 0.72. Should NOT alert (still tracked as alerted)
        (global.fetch as jest.Mock).mockReturnValueOnce(mockApiResponse([{ slug: 'm-hyst-1', label: 'M Hyst 1', price: 0.72 }]));
        await checkAndAlert();
        expect(global.fetch).toHaveBeenCalledTimes(1); // Fetch only

        jest.clearAllMocks();

        // 4. Drop to 0.50. (0.50 < 0.55). Should CLEAR.
        (global.fetch as jest.Mock).mockReturnValueOnce(mockApiResponse([{ slug: 'm-hyst-1', label: 'M Hyst 1', price: 0.50 }]));
        await checkAndAlert();
        expect(global.fetch).toHaveBeenCalledTimes(1); // Fetch only (clearing is silent)

        jest.clearAllMocks();

        // 5. Rise to 0.70. Should Alert AGAIN.
        (global.fetch as jest.Mock).mockReturnValueOnce(mockApiResponse([{ slug: 'm-hyst-1', label: 'M Hyst 1', price: 0.70 }]))
            .mockReturnValueOnce(Promise.resolve({ ok: true }));
        await checkAndAlert();
        expect(global.fetch).toHaveBeenCalledTimes(2); // Fetch + Webhook
    });

    describe('heightened polling return value', () => {
        it('should return false when no markets exceed any threshold', async () => {
            (global.fetch as jest.Mock)
                .mockReturnValueOnce(mockApiResponse([
                    { slug: 'market-low', label: 'Market Low', price: 0.30 }
                ]));

            const result = await checkAndAlert();
            expect(result).toBe(false);
        });

        it('should return true when a market is between SOMETHING_IS_HAPPENING and SOMETHING_HAPPENED thresholds', async () => {
            (global.fetch as jest.Mock)
                .mockReturnValueOnce(mockApiResponse([
                    { slug: 'market-mid', label: 'Market Mid', price: 0.80 }
                ]))
                .mockReturnValueOnce(Promise.resolve({ ok: true } as Response));

            const result = await checkAndAlert();
            expect(result).toBe(true);
        });

        it('should return false when all markets are at or above SOMETHING_HAPPENED threshold', async () => {
            (global.fetch as jest.Mock)
                .mockReturnValueOnce(mockApiResponse([
                    { slug: 'market-high', label: 'Market High', price: 0.99 }
                ]))
                .mockReturnValueOnce(Promise.resolve({ ok: true } as Response));

            const result = await checkAndAlert();
            expect(result).toBe(false);
        });

        it('should return true if at least one market is in the heightened range among mixed markets', async () => {
            (global.fetch as jest.Mock)
                .mockReturnValueOnce(mockApiResponse([
                    { slug: 'market-low', label: 'Market Low', price: 0.30 },
                    { slug: 'market-mid', label: 'Market Mid', price: 0.75 },
                    { slug: 'market-high', label: 'Market High', price: 0.99 }
                ]))
                .mockReturnValueOnce(Promise.resolve({ ok: true } as Response));

            const result = await checkAndAlert();
            expect(result).toBe(true);
        });

        it('should return false on fetch error', async () => {
            (global.fetch as jest.Mock)
                .mockReturnValueOnce(Promise.reject(new Error('Network error')));

            const result = await checkAndAlert();
            expect(result).toBe(false);
        });
    });
});
