import { checkAndAlert, resetPreviousSpikeIds, ApiResponse, PizzaPlace } from './pizzaAlert';

global.fetch = jest.fn();

describe('checkAndAlert', () => {
    const mockFetch = global.fetch as jest.Mock;

    beforeEach(() => {
        mockFetch.mockClear();
        resetPreviousSpikeIds(); // Reset state
    });

    it('should not alert if API fails', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500
        });

        await checkAndAlert();

        // Should try to fetch pizza data
        expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('pizzint.watch'));
        // Should NOT send discord alert
        expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('discord'), expect.anything());
    });

    it('should not alert if no spikes', async () => {
        const mockResponse: ApiResponse = {
            success: true,
            data: [],
            defcon_level: 5
        };
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse
        });

        await checkAndAlert();

        expect(mockFetch).toHaveBeenCalledTimes(1); // Only pizza fetch
    });

    it('should alert on NEW spikes with low defcon', async () => {
        const mockPlace: PizzaPlace = {
            place_id: 'p1',
            name: 'Pizza 1',
            address: 'addr1',
            current_popularity: 100,
            is_spike: true,
            spike_magnitude: 50,
            percentage_of_usual: 200,
            recorded_at: '2023-01-01'
        };
        const mockResponse: ApiResponse = {
            success: true,
            data: [mockPlace],
            defcon_level: 2 // Alert condition
        };

        // First call: Pizza API
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse
        });

        // Second call: Discord API (mock success)
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => 'ok'
        });

        // Mock env var
        process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';

        await checkAndAlert();

        // Verify Discord alert sent
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenLastCalledWith(
            'https://discord.com/api/webhooks/test',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('Pizza 1')
            })
        );
    });

    it('should NOT alert if defcon is high', async () => {
        const mockPlace: PizzaPlace = {
            place_id: 'p1',
            name: 'Pizza 1',
            address: 'addr1',
            current_popularity: 100,
            is_spike: true,
            spike_magnitude: 50,
            percentage_of_usual: 200,
            recorded_at: '2023-01-01'
        };
        const mockResponse: ApiResponse = {
            success: true,
            data: [mockPlace],
            defcon_level: 5 // HIGH defcon -> No alert
        };

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse
        });

        await checkAndAlert();

        expect(mockFetch).toHaveBeenCalledTimes(1); // No discord call
    });

    it('should NOT alert for old spikes', async () => {
        const mockPlace: PizzaPlace = {
            place_id: 'p1',
            name: 'Pizza 1',
            address: 'addr1',
            current_popularity: 100,
            is_spike: true,
            spike_magnitude: 50,
            percentage_of_usual: 200,
            recorded_at: '2023-01-01'
        };
        const mockResponse: ApiResponse = {
            success: true,
            data: [mockPlace],
            defcon_level: 2
        };

        // RUN 1: Should alert
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse }); // Pizza
        mockFetch.mockResolvedValueOnce({ ok: true, text: async () => 'ok' }); // Discord

        process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';

        await checkAndAlert();
        expect(mockFetch).toHaveBeenCalledTimes(2);

        // RUN 2: Same spike -> Should NOT alert
        mockFetch.mockClear();
        mockFetch.mockResolvedValueOnce({ ok: true, json: async () => mockResponse }); // Pizza

        await checkAndAlert();

        expect(mockFetch).toHaveBeenCalledTimes(1); // Only pizza fetch, no discord
    });
});
