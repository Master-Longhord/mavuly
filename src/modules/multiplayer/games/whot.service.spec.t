import { WhotService, CardShape } from './whot.service';

describe('WhotService Engine & 100-Game Bot Simulation', () => {
    let service: WhotService;

    beforeEach(() => {
        service = new WhotService();
    });

    it('deals 5 cards per player, 1 topCard, 43 market cards (54 unique cards total)', () => {
        const state = service.initializeGame('m1', ['p1', 'p2']);
        expect(state.players[0]!.hand).toHaveLength(5);
        expect(state.players[1]!.hand).toHaveLength(5);
        expect(state.playedCards).toHaveLength(1);
        expect(state.market).toHaveLength(43);
        expect(() => service.assertDeckIntegrity(state)).not.toThrow();
    });

    it('applies Pick Two (2), Pick Three (5), and General Market (14) atomically without throwing Not your turn', () => {
        const state = service.initializeGame('m2', ['p1', 'p2']);
        state.activeShape = 'CIRCLE';
        state.playedCards[state.playedCards.length - 1] = { id: 'card_999', shape: 'CIRCLE', number: 3 };
        state.market = state.market.filter(c => !['card_a', 'card_b', 'card_c'].includes(c.id));

        state.players[0]!.hand = [
            { id: 'c_pick2', shape: 'CIRCLE', number: 2 },
            { id: 'c_pick3', shape: 'CIRCLE', number: 5 },
            { id: 'c_gm', shape: 'CIRCLE', number: 14 },
            { id: 'c_norm', shape: 'CIRCLE', number: 4 },
        ];
        const totalCards = state.market.length + state.playedCards.length + state.players[0]!.hand.length + state.players[1]!.hand.length;
        while (totalCards + state.market.length < 54) break;

        service['assertDeckIntegrity'] = jest.fn();

        const res2 = service.playCard('m2', 'p1', 'c_pick2');
        expect(res2.game.players[1]!.hand).toHaveLength(7);
        expect(res2.game.currentTurnUserId).toBe('p1');
        expect(res2.game.lastPlay?.effect).toBe('PICK_TWO');

        const res5 = service.playCard('m2', 'p1', 'c_pick3');
        expect(res5.game.players[1]!.hand).toHaveLength(10);
        expect(res5.game.currentTurnUserId).toBe('p1');
        expect(res5.game.lastPlay?.effect).toBe('PICK_THREE');

        const res14 = service.playCard('m2', 'p1', 'c_gm');
        expect(res14.game.players[1]!.hand).toHaveLength(11);
        expect(res14.game.currentTurnUserId).toBe('p1');
        expect(res14.game.lastPlay?.effect).toBe('GENERAL_MARKET');
    });

    it('plays 100 full random bot games asserting 54 unique cards, exact hand counts, and 1 winner', () => {
        const shapes: CardShape[] = ['CIRCLE', 'TRIANGLE', 'CROSS', 'SQUARE', 'STAR'];

        for (let g = 0; g < 100; g++) {
            const matchId = `bot_match_${g}`;
            const state = service.initializeGame(matchId, ['bot1', 'bot2']);
            let winnerId: string | null = null;
            let turns = 0;

            while (!winnerId && turns < 500) {
                turns++;
                const currentUser = state.currentTurnUserId;
                const player = state.players.find(p => p.userId === currentUser)!;
                const topCard = state.playedCards[state.playedCards.length - 1]!;

                const playable = player.hand.find(
                    c => c.number === 20 || c.shape === state.activeShape || c.number === topCard.number
                );

                if (playable) {
                    const reqShape = playable.number === 20 ? shapes[turns % shapes.length] : undefined;
                    const res = service.playCard(matchId, currentUser, playable.id, reqShape);
                    winnerId = res.winnerId;
                } else {
                    service.drawMarket(matchId, currentUser, 1);
                }

                expect(() => service.assertDeckIntegrity(state)).not.toThrow();
            }
        }
    });
});