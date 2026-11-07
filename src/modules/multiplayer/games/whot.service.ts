import { Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

export type CardShape = 'CIRCLE' | 'TRIANGLE' | 'CROSS' | 'SQUARE' | 'STAR' | 'WHOT';

export type WhotEffect =
    | 'PICK_TWO'
    | 'PICK_THREE'
    | 'GENERAL_MARKET'
    | 'HOLD_ON'
    | 'SUSPENSION'
    | 'WHOT'
    | 'NONE'
    | 'DRAW_MARKET';

export interface Card {
    id: string;
    shape: CardShape;
    number: number;
}

export interface LastPlayInfo {
    userId: string;
    cardId: string | null;
    effect: WhotEffect;
    affected: { userId: string; drew: number; skipped: boolean }[];
    requestedShape?: CardShape;
    checkupPenaltyDrew?: number;
}

export interface WhotGameState {
    matchId: string;
    players: { userId: string; hand: Card[] }[];
    market: Card[];
    playedCards: Card[];
    currentTurnUserId: string;
    activeShape: CardShape;
    lastPlay: LastPlayInfo | null;
}

const VALID_REQUESTED_SHAPES: CardShape[] = ['CIRCLE', 'TRIANGLE', 'CROSS', 'SQUARE', 'STAR'];
const ACTION_NUMBERS = [1, 2, 5, 8, 14, 20];

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

        return this.shuffle([...deck]);
    }

    private shuffle<T>(array: T[]): T[] {
        const copy = [...array];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j]!, copy[i]!];
        }
        return copy;
    }

    initializeGame(matchId: string, userIds: string[]): WhotGameState {
        const deck = this.generateDeck();
        const players = userIds.map(userId => ({
            userId,
            hand: deck.splice(0, 5),
        }));

        let firstCardIndex = deck.findIndex(c => !ACTION_NUMBERS.includes(c.number));
        if (firstCardIndex === -1) firstCardIndex = 0;

        const firstCard = deck.splice(firstCardIndex, 1)[0];
        if (!firstCard) throw new WsException('Deck generation failed');

        const gameState: WhotGameState = {
            matchId,
            players,
            market: deck,
            playedCards: [firstCard],
            currentTurnUserId: userIds[0]!,
            activeShape: firstCard.shape,
            lastPlay: null,
        };

        this.assertDeckIntegrity(gameState);
        this.activeGames.set(matchId, gameState);
        return gameState;
    }

    getGameState(matchId: string) {
        return this.activeGames.get(matchId);
    }

    drawMarket(matchId: string, userId: string, count: number = 1) {
        const game = this.activeGames.get(matchId);
        if (!game) throw new WsException('Game not found');
        if (game.currentTurnUserId !== userId) throw new WsException('Not your turn');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new WsException('Player not found');

        const drawnCards = this.forceDrawFromMarket(game, player, count);
        const nextPlayer = this.getPlayerAtOffset(game, userId, 1);
        game.currentTurnUserId = nextPlayer.userId;

        game.lastPlay = {
            userId,
            cardId: null,
            effect: 'DRAW_MARKET',
            affected: [{ userId, drew: drawnCards.length, skipped: false }],
        };

        this.assertDeckIntegrity(game);
        return { game, drawnCards };
    }

    playCard(matchId: string, userId: string, cardId: string, requestedShape?: CardShape) {
        const game = this.activeGames.get(matchId);
        if (!game) throw new WsException('Game not found');
        if (game.currentTurnUserId !== userId) throw new WsException('Not your turn');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new WsException('Player not found');

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) throw new WsException('You do not own this card');

        const card = player.hand[cardIndex]!;
        const topCard = game.playedCards[game.playedCards.length - 1]!;

        if (card.number !== 20 && card.shape !== game.activeShape && card.number !== topCard.number) {
            throw new WsException('Invalid move. Must match shape or number.');
        }

        const normalizedRequestedShape = requestedShape
            ? (requestedShape.toUpperCase() as CardShape)
            : undefined;

        if (card.number === 20) {
            if (!normalizedRequestedShape || !VALID_REQUESTED_SHAPES.includes(normalizedRequestedShape)) {
                throw new WsException('You must choose a valid shape (CIRCLE, TRIANGLE, CROSS, SQUARE, STAR) when playing Whot (20).');
            }
        }

        player.hand.splice(cardIndex, 1);
        game.playedCards.push(card);
        game.activeShape = card.number === 20 ? normalizedRequestedShape! : card.shape;

        const affected: { userId: string; drew: number; skipped: boolean }[] = [];
        let effect: WhotEffect = 'NONE';
        let nextTurnUserId = this.getPlayerAtOffset(game, userId, 1).userId;

        if (card.number === 1) {
            effect = 'HOLD_ON';
            const skippedPlayer = this.getPlayerAtOffset(game, userId, 1);
            affected.push({ userId: skippedPlayer.userId, drew: 0, skipped: true });
            nextTurnUserId = userId;
        } else if (card.number === 2) {
            effect = 'PICK_TWO';
            const target = this.getPlayerAtOffset(game, userId, 1);
            const drawn = this.forceDrawFromMarket(game, target, 2);
            affected.push({ userId: target.userId, drew: drawn.length, skipped: true });
            nextTurnUserId = this.getPlayerAtOffset(game, userId, 2).userId;
        } else if (card.number === 5) {
            effect = 'PICK_THREE';
            const target = this.getPlayerAtOffset(game, userId, 1);
            const drawn = this.forceDrawFromMarket(game, target, 3);
            affected.push({ userId: target.userId, drew: drawn.length, skipped: true });
            nextTurnUserId = this.getPlayerAtOffset(game, userId, 2).userId;
        } else if (card.number === 8) {
            effect = 'SUSPENSION';
            const target = this.getPlayerAtOffset(game, userId, 1);
            affected.push({ userId: target.userId, drew: 0, skipped: true });
            nextTurnUserId = this.getPlayerAtOffset(game, userId, 2).userId;
        } else if (card.number === 14) {
            effect = 'GENERAL_MARKET';
            for (const other of game.players) {
                if (other.userId !== userId) {
                    const drawn = this.forceDrawFromMarket(game, other, 1);
                    affected.push({ userId: other.userId, drew: drawn.length, skipped: true });
                }
            }
            nextTurnUserId = userId;
        } else if (card.number === 20) {
            effect = 'WHOT';
            nextTurnUserId = this.getPlayerAtOffset(game, userId, 1).userId;
        }

        let checkupPenaltyDrew = 0;
        let winnerId: string | null = null;

        if (player.hand.length === 0) {
            if (ACTION_NUMBERS.includes(card.number)) {
                const penaltyCards = this.forceDrawFromMarket(game, player, 2);
                checkupPenaltyDrew = penaltyCards.length;
            } else {
                winnerId = userId;
            }
        }

        game.currentTurnUserId = nextTurnUserId;
        game.lastPlay = {
            userId,
            cardId: card.id,
            effect,
            affected,
            ...(card.number === 20 && normalizedRequestedShape ? { requestedShape: normalizedRequestedShape } : {}),
            ...(checkupPenaltyDrew > 0 ? { checkupPenaltyDrew } : {}),
        };

        this.assertDeckIntegrity(game);
        return { game, winnerId };
    }

    private forceDrawFromMarket(
        game: WhotGameState,
        player: { userId: string; hand: Card[] },
        count: number
    ): Card[] {
        const drawn: Card[] = [];

        for (let i = 0; i < count; i++) {
            if (game.market.length === 0) {
                if (game.playedCards.length <= 1) {
                    break;
                }
                const recyclable = game.playedCards.splice(0, game.playedCards.length - 1);
                game.market.push(...this.shuffle(recyclable));
            }

            const nextCard = game.market.shift();
            if (nextCard) {
                player.hand.push(nextCard);
                drawn.push(nextCard);
            }
        }

        return drawn;
    }

    private getPlayerAtOffset(game: WhotGameState, fromUserId: string, offset: number) {
        const currentIndex = game.players.findIndex(p => p.userId === fromUserId);
        const nextIndex = (currentIndex + offset) % game.players.length;
        return game.players[nextIndex]!;
    }

    assertDeckIntegrity(game: WhotGameState) {
        const seen = new Set<string>();
        const allCards: Card[] = [
            ...game.market,
            ...game.playedCards,
            ...game.players.flatMap(p => p.hand),
        ];

        for (const c of allCards) {
            if (seen.has(c.id)) {
                throw new WsException(`Deck integrity violation: duplicate card ${c.id}`);
            }
            seen.add(c.id);
        }

        if (seen.size !== 54) {
            throw new WsException(`Deck integrity violation: expected 54 unique cards, found ${seen.size}`);
        }
    }
}