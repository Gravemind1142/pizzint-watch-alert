import { checkAndAlertCommute, resetPreviousLevel, setPreviousLevel, CommuteResponse, getPreviousLevel } from './optempoAlert';

global.fetch = jest.fn();

describe('checkAndAlertCommute', () => {
    const mockFetch = global.fetch as jest.Mock;

    beforeEach(() => {
        mockFetch.mockClear();
        resetPreviousLevel(); // Reset state to 5
        process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';
    });

    const createMockResponse = (level: number): CommuteResponse => ({
        metro: { current: 50, baseline: 50, popularityRatio: 1 },
        optempo: {
            color: '#000000',
            label: 'Test Label',
            level: level,
            value: level,
            summary: {
                corridorsTotal: 1,
                dominantSignal: 'Test',
                crossCorrelation: 0,
                tier1AvgDeviation: 0,
                tier2AvgDeviation: 0,
                corridorsReporting: 1
            },
            timeWindow: {
                label: 'TEST',
                hourET: 12,
                window: 'test',
                isWeekend: false,
                expectedRatio: 1,
                sensitivityMultiplier: 1
            },
            description: 'Test Description',
            rawDeviation: 0
        },
        success: true,
        timestamp: new Date().toISOString()
    });

    it('should not alert if API fails', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
        await checkAndAlertCommute();
        expect(mockFetch).toHaveBeenCalledTimes(1); // Only fetch
        expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('discord'), expect.anything());
    });

    it('should not alert if data is invalid', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) });
        await checkAndAlertCommute();
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not alert on init (Level 5)', async () => {
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => createMockResponse(5) });
        await checkAndAlertCommute();
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(getPreviousLevel()).toBe(5);
    });

    it('should alert on escalation (5 -> 4)', async () => {
        // Init is 5.
        // Mock fetch returns 4.
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => createMockResponse(4) });
        // Mock discord success
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => 'ok' });

        await checkAndAlertCommute();

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenLastCalledWith(
            'https://discord.com/api/webhooks/test',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('Alert: 4')
            })
        );
        expect(getPreviousLevel()).toBe(4);
    });

    it('should NOT alert if level stays the same (4 -> 4)', async () => {
        setPreviousLevel(4);
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => createMockResponse(4) });

        await checkAndAlertCommute();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(getPreviousLevel()).toBe(4);
    });

    it('should alert on further escalation (4 -> 3)', async () => {
        setPreviousLevel(4);
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => createMockResponse(3) });
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => 'ok' });

        await checkAndAlertCommute();

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenLastCalledWith(
            expect.stringContaining('discord'),
            expect.objectContaining({ body: expect.stringContaining('Alert: 3') })
        );
        expect(getPreviousLevel()).toBe(3);
    });

    it('should NOT alert on improvement (3 -> 4)', async () => {
        setPreviousLevel(3);
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => createMockResponse(4) });

        await checkAndAlertCommute();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(getPreviousLevel()).toBe(4); // State updated, but no alert
    });

    it('should NOT alert if threshold not met (e.g. 5 -> 5)', async () => {
        // Default threshold is 4.
        setPreviousLevel(5);
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => createMockResponse(5) });

        await checkAndAlertCommute();

        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(getPreviousLevel()).toBe(5);
    });

    // Note: The implementation has internal constant ALERT_THRESHOLD = 4.
    // We cannot easily change that const for testing without exporting it or using rewiring.
    // So we assume it is 4 for these tests.
});
