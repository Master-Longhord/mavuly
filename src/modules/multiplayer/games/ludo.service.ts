import { Injectable } from '@nestjs/common';

export type LudoColor = 'RED' | 'GREEN' | 'YELLOW' | 'BLUE';

export interface LudoToken {
    id: number;
    position: number;
}

export interface LudoGameState {
    matchId: string;
    players: { userId: string; color: LudoColor; tokens: LudoToken[] }[];
    currentTurnUserId: string;
    lastDiceRoll: number | null;
    hasRolled: boolean;
}

@Injectable()
export class LudoService {
    private activeGames = new Map<string, LudoGameState>();
    private colors: LudoColor[] = ['RED', 'GREEN', 'YELLOW', 'BLUE'];
    private safeZones = [1, 9, 14, 22, 27, 35, 40, 48];

    initializeGame(matchId: string, userIds: string[]): LudoGameState {
        const players = userIds.map((userId, index) => ({
            userId,
            color: this.colors[index]!,
            tokens: [
                { id: 1, position: 0 },
                { id: 2, position: 0 },
                { id: 3, position: 0 },
                { id: 4, position: 0 }
            ]
        }));

        const gameState: LudoGameState = {
            matchId,
            players,
            currentTurnUserId: userIds[0]!,
            lastDiceRoll: null,
            hasRolled: false,
        };

        this.activeGames.set(matchId, gameState);
        return gameState;
    }

    getGameState(matchId: string) {
        return this.activeGames.get(matchId);
    }

    rollDice(matchId: string, userId: string) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');
        if (game.hasRolled) throw new Error('You already rolled the dice! Please move a token.');

        const roll = Math.floor(Math.random() * 6) + 1;
        game.lastDiceRoll = roll;
        game.hasRolled = true;

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new Error('Player not found');

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
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');
        if (!game.hasRolled || !game.lastDiceRoll) throw new Error('You must roll the dice first');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new Error('Player not found');

        const token = player.tokens.find(t => t.id === tokenId);
        if (!token) throw new Error('Token not found');

        const roll = game.lastDiceRoll;

        if (token.position === 0) {
            if (roll !== 6) throw new Error('You need a 6 to move a token out of base');
            token.position = 1;
        } else {
            if (token.position + roll > 57) throw new Error('Invalid move, needs exact roll to finish');
            token.position += roll;
        }

        let capturedSomeone = false;
        if (token.position > 0 && token.position <= 51 && !this.safeZones.includes(token.position)) {
            const myGlobalPos = this.getGlobalPosition(player.color, token.position);

            for (const opponent of game.players) {
                if (opponent.userId === userId) continue;
                for (const oppToken of opponent.tokens) {
                    if (oppToken.position > 0 && oppToken.position <= 51) {
                        const oppGlobalPos = this.getGlobalPosition(opponent.color, oppToken.position);
                        if (myGlobalPos === oppGlobalPos) {
                            oppToken.position = 0;
                            capturedSomeone = true;
                        }
                    }
                }
            }
        }

        const hasWon = player.tokens.every(t => t.position === 57);
        if (hasWon) return { game, winnerId: userId };

        if (roll === 6 || capturedSomeone) {
            game.hasRolled = false;
            game.lastDiceRoll = null;
        } else {
            this.nextTurn(game);
        }

        return { game, winnerId: null };
    }

    private getGlobalPosition(color: LudoColor, relativePos: number): number {
        const startOffsets = { 'RED': 0, 'GREEN': 13, 'YELLOW': 26, 'BLUE': 39 };
        return (relativePos - 1 + startOffsets[color]) % 52;
    }

    private nextTurn(game: LudoGameState) {
        const currentIndex = game.players.findIndex(p => p.userId === game.currentTurnUserId);
        game.currentTurnUserId = game.players[(currentIndex + 1) % game.players.length]!.userId;
        game.hasRolled = false;
        game.lastDiceRoll = null;
    }
}