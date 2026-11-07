import { Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

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
    playDirection: 1 | -1;
    lastPlay: {
        userId: string;
        cardId: string | null;
        effect: string;
        affected: { userId: string; drew: number; skipped: boolean }[];
        requestedShape?: UnoColor;
    } | null;
}

const VALID_UNO_COLORS: UnoColor[] = ['RED', 'YELLOW', 'GREEN', 'BLUE'];
const UNO_ACTION_TYPES: UnoType[] = ['SKIP', 'REVERSE', 'DRAW_TWO', 'WILD', 'WILD_DRAW_FOUR'];

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

    private shuffle<T>(array: T[]): T[] {
        const copy = [...array];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j]!, copy[i]!];
        }
        return copy;
    }

    initializeGame(matchId: string, userIds: string[]): UnoGameState {
        const deck = this.generateDeck();
        const players = userIds.map(userId => ({ userId, hand: deck.splice(0, 7) }));

        let firstIndex = deck.findIndex(c => c.color !== 'WILD' && !UNO_ACTION_TYPES.includes(c.type));
        if (firstIndex === -1) firstIndex = 0;
        const firstCard = deck.splice(firstIndex, 1)[0];
        if (!firstCard) throw new WsException('Deck generation failed');

        const gameState: UnoGameState = {
            matchId,
            players,
            market: deck,
            playedCards: [firstCard],
            currentTurnUserId: userIds[0]!,
            activeColor: firstCard.color,
            playDirection: 1,
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
        game.currentTurnUserId = this.getPlayerAtStep(game, userId, 1).userId;
        game.lastPlay = {
            userId,
            cardId: null,
            effect: 'DRAW_MARKET',
            affected: [{ userId, drew: drawnCards.length, skipped: false }],
        };

        this.assertDeckIntegrity(game);
        return { game, drawnCards };
    }

    playCard(matchId: string, userId: string, cardId: string, requestedColor?: UnoColor) {
        const game = this.activeGames.get(matchId);
        if (!game) throw new WsException('Game not found');
        if (game.currentTurnUserId !== userId) throw new WsException('Not your turn');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new WsException('Player not found');

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        if (cardIndex === -1) throw new WsException('You do not own this card');

        const card = player.hand[cardIndex]!;
        const topCard = game.playedCards[game.playedCards.length - 1]!;

        if (card.color !== 'WILD' && card.color !== game.activeColor && card.type !== topCard.type) {
            throw new WsException('Invalid move. Must match color or number/symbol.');
        }

        const normalizedColor = requestedColor ? (requestedColor.toUpperCase() as UnoColor) : undefined;
        if (card.color === 'WILD' && (!normalizedColor || !VALID_UNO_COLORS.includes(normalizedColor))) {
            throw new WsException('You must provide a valid requestedShape color (RED, YELLOW, GREEN, BLUE) when playing a Wild card.');
        }

        player.hand.splice(cardIndex, 1);
        game.playedCards.push(card);
        game.activeColor = card.color === 'WILD' ? normalizedColor! : card.color;

        const affected: { userId: string; drew: number; skipped: boolean }[] = [];
        let effect = 'NONE';
        let nextTurnUserId = this.getPlayerAtStep(game, userId, 1).userId;

        if (card.type === 'REVERSE') {
            effect = 'HOLD_ON';
            game.playDirection = (game.playDirection * -1) as 1 | -1;
            if (game.players.length === 2) {
                const target = this.getPlayerAtStep(game, userId, 1);
                affected.push({ userId: target.userId, drew: 0, skipped: true });
                nextTurnUserId = userId;
            } else {
                nextTurnUserId = this.getPlayerAtStep(game, userId, 1).userId;
            }
        } else if (card.type === 'SKIP') {
            effect = 'SUSPENSION';
            const target = this.getPlayerAtStep(game, userId, 1);
            affected.push({ userId: target.userId, drew: 0, skipped: true });
            nextTurnUserId = this.getPlayerAtStep(game, userId, 2).userId;
        } else if (card.type === 'DRAW_TWO') {
            effect = 'PICK_TWO';
            const target = this.getPlayerAtStep(game, userId, 1);
            const drawn = this.forceDrawFromMarket(game, target, 2);
            affected.push({ userId: target.userId, drew: drawn.length, skipped: true });
            nextTurnUserId = this.getPlayerAtStep(game, userId, 2).userId;
        } else if (card.type === 'WILD_DRAW_FOUR') {
            effect = 'PICK_THREE';
            const target = this.getPlayerAtStep(game, userId, 1);
            const drawn = this.forceDrawFromMarket(game, target, 4);
            affected.push({ userId: target.userId, drew: drawn.length, skipped: true });
            nextTurnUserId = this.getPlayerAtStep(game, userId, 2).userId;
        } else if (card.type === 'WILD') {
            effect = 'WHOT';
            nextTurnUserId = this.getPlayerAtStep(game, userId, 1).userId;
        }

        let winnerId: string | null = null;
        if (player.hand.length === 0) {
            if (UNO_ACTION_TYPES.includes(card.type)) {
                this.forceDrawFromMarket(game, player, 2);
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
            ...(card.color === 'WILD' && normalizedColor ? { requestedShape: normalizedColor } : {}),
        };

        this.assertDeckIntegrity(game);
        return { game, winnerId };
    }

    private forceDrawFromMarket(
        game: UnoGameState,
        player: { userId: string; hand: UnoCard[] },
        count: number
    ): UnoCard[] {
        const drawn: UnoCard[] = [];
        for (let i = 0; i < count; i++) {
            if (game.market.length === 0) {
                if (game.playedCards.length <= 1) break;
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

    private getPlayerAtStep(game: UnoGameState, fromUserId: string, steps: number) {
        const currentIndex = game.players.findIndex(p => p.userId === fromUserId);
        const total = game.players.length;
        const nextIndex = (((currentIndex + steps * game.playDirection) % total) + total) % total;
        return game.players[nextIndex]!;
    }

    assertDeckIntegrity(game: UnoGameState) {
        const seen = new Set<string>();
        const allCards = [
            ...game.market,
            ...game.playedCards,
            ...game.players.flatMap(p => p.hand),
        ];
        for (const c of allCards) {
            if (seen.has(c.id)) {
                throw new WsException(`Uno deck integrity violation: duplicate card ${c.id}`);
            }
            seen.add(c.id);
        }
        if (seen.size !== 108) {
            throw new WsException(`Uno deck integrity violation: expected 108 cards, found ${seen.size}`);
        }
    }
}