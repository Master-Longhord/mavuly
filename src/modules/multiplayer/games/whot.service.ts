import { Injectable } from '@nestjs/common';

export type CardShape = 'CIRCLE' | 'TRIANGLE' | 'CROSS' | 'SQUARE' | 'STAR' | 'WHOT';

export interface Card {
    id: string;
    shape: CardShape;
    number: number;
}

export interface WhotGameState {
    matchId: string;
    players: { userId: string; hand: Card[] }[];
    market: Card[];
    playedCards: Card[];
    currentTurnUserId: string;
    activeShape: CardShape;
}

@Injectable()
export class WhotService {
    private activeGames = new Map<string, WhotGameState>();

    private generateDeck(): Card[] {
        const deck: Card[] = [];
        let idCounter = 1;

        const addCards = (shape: CardShape, numbers: number[]) => {
            for (const num of numbers) {
                deck.push({ id: `card_${idCounter++}`, shape, number: num });
            }
        };

        addCards('CIRCLE', [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]);
        addCards('TRIANGLE', [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14]);
        addCards('CROSS', [1, 2, 3, 5, 7, 10, 11, 13, 14]);
        addCards('SQUARE', [1, 2, 3, 5, 7, 10, 11, 13, 14]);
        addCards('STAR', [1, 2, 3, 4, 5, 7, 8]);
        addCards('WHOT', [20, 20, 20, 20, 20]);

        return this.shuffle(deck);
    }

    private shuffle(array: any[]) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // 2. INITIALIZE THE GAME AND DEAL CARDS
    initializeGame(matchId: string, userIds: string[]): WhotGameState {
        const deck = this.generateDeck();
        const players = [];

        for (const userId of userIds) {
            const hand = deck.splice(0, 5);
            players.push({ userId, hand });
        }

        let firstCardIndex = deck.findIndex(c => ![1, 2, 5, 8, 14, 20].includes(c.number));
        if (firstCardIndex === -1) firstCardIndex = 0;

        const firstCard = deck.splice(firstCardIndex, 1)[0];
        if (!firstCard) throw new Error('Deck generation failed'); // <-- TS FIX

        const gameState: WhotGameState = {
            matchId,
            players,
            market: deck,
            playedCards: [firstCard],
            currentTurnUserId: userIds[0],
            activeShape: firstCard.shape,
        };

        this.activeGames.set(matchId, gameState);
        return gameState;
    }

    // 3. DRAW FROM MARKET
    drawMarket(matchId: string, userId: string, count: number = 1) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new Error('Player not found');

        if (game.market.length < count) {
            const topCard = game.playedCards.pop();
            if (!topCard) throw new Error('Played cards pile is empty'); // <-- TS FIX

            game.market.push(...this.shuffle(game.playedCards));
            game.playedCards = [topCard];
        }

        const drawnCards = game.market.splice(0, count);
        player.hand.push(...drawnCards);

        this.nextTurn(game);
        return { game, drawnCards };
    }

    playCard(matchId: string, userId: string, cardId: string, requestedShape?: CardShape) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new Error('Player not found'); // <-- THIS FIXES THE ERROR!

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) throw new Error('You do not own this card');

        const card = player.hand[cardIndex];
        const topCard = game.playedCards[game.playedCards.length - 1];

        if (card.number !== 20 && card.shape !== game.activeShape && card.number !== topCard.number) {
            throw new Error('Invalid move. Must match shape or number.');
        }

        player.hand.splice(cardIndex, 1);
        game.playedCards.push(card);
        game.activeShape = card.number === 20 && requestedShape ? requestedShape : card.shape;

        if (player.hand.length === 0) {
            if ([1, 2, 5, 8, 14, 20].includes(card.number)) {
                this.drawMarket(matchId, userId, 2);
            } else {
                return { game, winnerId: userId };
            }
        }

        if (card.number === 1) {
            // Hold on
        } else if (card.number === 2) {
            const nextPlayer = this.getNextPlayer(game);
            this.drawMarket(matchId, nextPlayer.userId, 2);
        } else if (card.number === 5) {
            const nextPlayer = this.getNextPlayer(game);
            this.drawMarket(matchId, nextPlayer.userId, 3);
        } else if (card.number === 8) {
            this.nextTurn(game);
            this.nextTurn(game);
        } else if (card.number === 14) {
            for (const p of game.players) {
                if (p.userId !== userId) this.drawMarket(matchId, p.userId, 1);
            }
            this.nextTurn(game);
        } else {
            this.nextTurn(game);
        }

        return { game, winnerId: null };
    }

    private getNextPlayer(game: WhotGameState) {
        const currentIndex = game.players.findIndex(p => p.userId === game.currentTurnUserId);
        const nextIndex = (currentIndex + 1) % game.players.length;
        return game.players[nextIndex];
    }

    private nextTurn(game: WhotGameState) {
        game.currentTurnUserId = this.getNextPlayer(game).userId;
    }
}