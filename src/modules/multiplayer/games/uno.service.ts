import { Injectable } from '@nestjs/common';

export type UnoColor = 'RED' | 'YELLOW' | 'GREEN' | 'BLUE' | 'WILD';
export type UnoType = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'SKIP' | 'REVERSE' | 'DRAW_TWO' | 'WILD' | 'WILD_DRAW_FOUR';

export interface UnoCard {
    id: string;
    color: UnoColor;
    type: UnoType;
}

export interface UnoGameState {
    matchId: string;
    players: { userId: string; hand: UnoCard[] }[];
    market: UnoCard[];
    playedCards: UnoCard[];
    currentTurnUserId: string;
    activeColor: UnoColor;
    playDirection: 1 | -1; // 1 for clockwise, -1 for counter-clockwise
}

@Injectable()
export class UnoService {
    private activeGames = new Map<string, UnoGameState>();

    private generateDeck(): UnoCard[] {
        const deck: UnoCard[] = [];
        let idCounter = 1;
        const colors: UnoColor[] = ['RED', 'YELLOW', 'GREEN', 'BLUE'];

        for (const color of colors) {
            deck.push({ id: `uno_${idCounter++}`, color, type: '0' });
            for (let i = 1; i <= 9; i++) {
                deck.push({ id: `uno_${idCounter++}`, color, type: i.toString() as UnoType });
                deck.push({ id: `uno_${idCounter++}`, color, type: i.toString() as UnoType });
            }
            for (let i = 0; i < 2; i++) {
                deck.push({ id: `uno_${idCounter++}`, color, type: 'SKIP' });
                deck.push({ id: `uno_${idCounter++}`, color, type: 'REVERSE' });
                deck.push({ id: `uno_${idCounter++}`, color, type: 'DRAW_TWO' });
            }
        }
        for (let i = 0; i < 4; i++) {
            deck.push({ id: `uno_${idCounter++}`, color: 'WILD', type: 'WILD' });
            deck.push({ id: `uno_${idCounter++}`, color: 'WILD', type: 'WILD_DRAW_FOUR' });
        }
        return this.shuffle(deck);
    }

    private shuffle(array: any[]) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    initializeGame(matchId: string, userIds: string[]): UnoGameState {
        const deck = this.generateDeck();
        const players = userIds.map(userId => ({ userId, hand: deck.splice(0, 7) })); // Deal 7 cards

        // First card cannot be a WILD for simplicity
        let firstIndex = deck.findIndex(c => c.color !== 'WILD' && !['SKIP', 'REVERSE', 'DRAW_TWO'].includes(c.type));
        if (firstIndex === -1) firstIndex = 0;
        const firstCard = deck.splice(firstIndex, 1)[0];
        if (!firstCard) throw new Error('Deck generation failed');

        const gameState: UnoGameState = {
            matchId, players, market: deck, playedCards: [firstCard],
            currentTurnUserId: userIds[0], activeColor: firstCard.color, playDirection: 1,
        };

        this.activeGames.set(matchId, gameState);
        return gameState;
    }

    drawMarket(matchId: string, userId: string, count: number = 1) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new Error('Player not found');

        if (game.market.length < count) {
            const topCard = game.playedCards.pop();
            game.market.push(...this.shuffle(game.playedCards));
            game.playedCards = [topCard!];
        }

        player.hand.push(...game.market.splice(0, count));
        this.nextTurn(game);
        return { game };
    }

    playCard(matchId: string, userId: string, cardId: string, requestedColor?: UnoColor) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new Error('Player not found');

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) throw new Error('You do not own this card');

        const card = player.hand[cardIndex];
        const topCard = game.playedCards[game.playedCards.length - 1];

        // VALIDATION: Must match Color, Type, or be a Wild Card
        if (card.color !== 'WILD' && card.color !== game.activeColor && card.type !== topCard.type) {
            throw new Error('Invalid move. Must match color or number/symbol.');
        }
        if (card.color === 'WILD' && !requestedColor) {
            throw new Error('You must provide a requestedColor when playing a Wild card.');
        }

        player.hand.splice(cardIndex, 1);
        game.playedCards.push(card);
        game.activeColor = card.color === 'WILD' ? requestedColor! : card.color;

        if (player.hand.length === 0) return { game, winnerId: userId }; // WINNER!

        // ACTION CARDS
        if (card.type === 'REVERSE') {
            game.playDirection = (game.playDirection * -1) as 1 | -1;
            if (game.players.length === 2) this.nextTurn(game); // In 2-player, Reverse acts like a Skip
        } else if (card.type === 'SKIP') {
            this.nextTurn(game);
        } else if (card.type === 'DRAW_TWO') {
            const nextPlayer = this.getNextPlayer(game);
            this.forceDraw(game, nextPlayer.userId, 2);
            this.nextTurn(game); // Skip their turn
        } else if (card.type === 'WILD_DRAW_FOUR') {
            const nextPlayer = this.getNextPlayer(game);
            this.forceDraw(game, nextPlayer.userId, 4);
            this.nextTurn(game); // Skip their turn
        }

        this.nextTurn(game);
        return { game, winnerId: null };
    }

    private forceDraw(game: UnoGameState, userId: string, count: number) {
        const player = game.players.find(p => p.userId === userId);
        if (game.market.length < count) {
            const topCard = game.playedCards.pop();
            game.market.push(...this.shuffle(game.playedCards));
            game.playedCards = [topCard!];
        }
        player!.hand.push(...game.market.splice(0, count));
    }

    private getNextPlayer(game: UnoGameState) {
        const currentIndex = game.players.findIndex(p => p.userId === game.currentTurnUserId);
        let nextIndex = (currentIndex + game.playDirection) % game.players.length;
        if (nextIndex < 0) nextIndex += game.players.length;
        return game.players[nextIndex];
    }

    private nextTurn(game: UnoGameState) {
        game.currentTurnUserId = this.getNextPlayer(game).userId;
    }
}