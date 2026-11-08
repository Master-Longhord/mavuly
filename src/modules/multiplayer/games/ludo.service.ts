import { Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

export type LudoColor = 'RED' | 'GREEN' | 'YELLOW' | 'BLUE';

export interface LudoToken {
    id: number;
    position: number;
}

export interface LudoLastMove {
    userId: string;
    tokenId: number;
    from: number;
    to: number;
    captured: { userId: string; tokenId: number }[];
    bonusRoll: boolean;
    finishedTokenIds: number[];
}

export interface LudoPlayer {
    userId: string;
    color: LudoColor;
    startOffset: number;
    tokens: LudoToken[];
}

export interface LudoGameState {
    matchId: string;
    players: LudoPlayer[];
    currentTurnUserId: string;
    lastDiceRoll: number | null;
    hasRolled: boolean;
    lastMove: LudoLastMove | null;
}

const COLOR_OFFSETS: Record<LudoColor, number> = {
    RED: 0,
    GREEN: 13,
    YELLOW: 26,
    BLUE: 39,
};

@Injectable()
export class LudoService {
    private activeGames = new Map<string, LudoGameState>();
    private safeZones = [1, 9, 14, 22, 27, 35, 40, 48];

    initializeGame(matchId: string, userIds: string[]): LudoGameState {
        const seatColors: LudoColor[] =
            userIds.length === 2
                ? ['RED', 'YELLOW']
                : ['RED', 'GREEN', 'YELLOW', 'BLUE'];

        const players: LudoPlayer[] = userIds.map((userId, index) => {
            const color = seatColors[index]!;
            return {
                userId,
                color,
                startOffset: COLOR_OFFSETS[color],
                tokens: [
                    { id: 1, position: 0 },
                    { id: 2, position: 0 },
                    { id: 3, position: 0 },
                    { id: 4, position: 0 },
                ],
            };
        });

        const gameState: LudoGameState = {
            matchId,
            players,
            currentTurnUserId: userIds[0]!,
            lastDiceRoll: null,
            hasRolled: false,
            lastMove: null,
        };

        this.activeGames.set(matchId, gameState);
        return gameState;
    }

    getGameState(matchId: string) {
        return this.activeGames.get(matchId);
    }

    rollDice(matchId: string, userId: string) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new WsException('Not your turn');
        if (game.hasRolled) throw new WsException('You already rolled the dice! Please move a token.');

        const roll = Math.floor(Math.random() * 6) + 1;
        game.lastDiceRoll = roll;
        game.hasRolled = true;

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new WsException('Player not found');

        const movableTokenIds = player.tokens
            .filter(t => (t.position === 0 && roll === 6) || (t.position > 0 && t.position + roll <= 57))
            .map(t => t.id);

        if (movableTokenIds.length === 0) {
            this.nextTurn(game);
            return { game, roll, skipped: true, movableTokenIds: [] };
        }

        return { game, roll, skipped: false, movableTokenIds };
    }

    moveToken(matchId: string, userId: string, tokenId: number) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new WsException('Not your turn');
        if (!game.hasRolled || !game.lastDiceRoll) throw new WsException('You must roll the dice first');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new WsException('Player not found');

        const token = player.tokens.find(t => t.id === tokenId);
        if (!token) throw new WsException('Token not found');

        const roll = game.lastDiceRoll;
        const from = token.position;
        let to = from;

        if (from === 0) {
            if (roll !== 6) throw new WsException('You need a 6 to move a token out of base');
            to = 1;
        } else {
            if (from + roll > 57) throw new WsException('Invalid move, needs exact roll to finish');
            to = from + roll;
        }

        token.position = to;

        const captured: { userId: string; tokenId: number }[] = [];
        if (to > 0 && to <= 51 && !this.safeZones.includes(to)) {
            const myGlobalPos = this.getGlobalPosition(player.startOffset, to);

            for (const opponent of game.players) {
                if (opponent.userId === userId) continue;
                for (const oppToken of opponent.tokens) {
                    if (oppToken.position > 0 && oppToken.position <= 51) {
                        const oppGlobalPos = this.getGlobalPosition(opponent.startOffset, oppToken.position);
                        if (myGlobalPos === oppGlobalPos) {
                            oppToken.position = 0;
                            captured.push({ userId: opponent.userId, tokenId: oppToken.id });
                        }
                    }
                }
            }
        }

        const finishedTokenIds = player.tokens.filter(t => t.position === 57).map(t => t.id);
        const hasWon = finishedTokenIds.length === 4;
        const reachedHomeThisMove = from < 57 && to === 57;
        const bonusRoll = !hasWon && (roll === 6 || captured.length > 0 || reachedHomeThisMove);

        game.lastMove = {
            userId,
            tokenId,
            from,
            to,
            captured,
            bonusRoll,
            finishedTokenIds,
        };

        if (hasWon) {
            game.hasRolled = false;
            game.lastDiceRoll = null;
            return { game, winnerId: userId };
        }

        if (bonusRoll) {
            game.hasRolled = false;
            game.lastDiceRoll = null;
        } else {
            this.nextTurn(game);
        }

        return { game, winnerId: null };
    }

    private getGlobalPosition(startOffset: number, relativePos: number): number {
        return (relativePos - 1 + startOffset) % 52;
    }

    private nextTurn(game: LudoGameState) {
        const currentIndex = game.players.findIndex(p => p.userId === game.currentTurnUserId);
        game.currentTurnUserId = game.players[(currentIndex + 1) % game.players.length]!.userId;
        game.hasRolled = false;
        game.lastDiceRoll = null;
    }
}