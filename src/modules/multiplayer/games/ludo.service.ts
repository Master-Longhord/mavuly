import { Injectable } from '@nestjs/common';

export type LudoColor = 'RED' | 'GREEN' | 'YELLOW' | 'BLUE';

export interface LudoToken {
    id: number;      // 1, 2, 3, 4
    position: number; // 0 = Base, 1 = Start, 1-51 = Main Track, 52-56 = Home Run, 57 = FINISHED
}

export interface LudoGameState {
    matchId: string;
    players: { userId: string; color: LudoColor; tokens: LudoToken[] }[];
    currentTurnUserId: string;
    lastDiceRoll: number | null;
    hasRolled: boolean; // Prevents rolling twice in one turn
}

@Injectable()
export class LudoService {
    private activeGames = new Map<string, LudoGameState>();
    private colors: LudoColor[] = ['RED', 'GREEN', 'YELLOW', 'BLUE'];

    // Safe zones where tokens can't be captured (Star spaces + Starting spaces)
    private safeZones = [1, 9, 14, 22, 27, 35, 40, 48];

    // 1. INITIALIZE GAME
    initializeGame(matchId: string, userIds: string[]): LudoGameState {
        const players = userIds.map((userId, index) => ({
            userId,
            color: this.colors[index],
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
            currentTurnUserId: userIds[0],
            lastDiceRoll: null,
            hasRolled: false,
        };

        this.activeGames.set(matchId, gameState);
        return gameState;
    }

    // 2. ROLL DICE (Server-side RNG to prevent cheating)
    rollDice(matchId: string, userId: string) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');
        if (game.hasRolled) throw new Error('You already rolled the dice! Please move a token.');

        // Generate 1-6
        const roll = Math.floor(Math.random() * 6) + 1;
        game.lastDiceRoll = roll;
        game.hasRolled = true;

        // Auto-skip turn if they rolled < 6 and have no tokens outside of base
        const player = game.players.find(p => p.userId === userId);
        const canMove = player!.tokens.some(t =>
            (t.position === 0 && roll === 6) || // Can bring one out
            (t.position > 0 && t.position + roll <= 57) // Can move one forward
        );

        if (!canMove) {
            this.nextTurn(game); // Skip their turn
            return { game, roll, skipped: true };
        }

        return { game, roll, skipped: false };
    }

    // 3. MOVE TOKEN & COLLISION DETECTION
    moveToken(matchId: string, userId: string, tokenId: number) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');
        if (!game.hasRolled || !game.lastDiceRoll) throw new Error('You must roll the dice first');

        const player = game.players.find(p => p.userId === userId)!;
        const token = player.tokens.find(t => t.id === tokenId)!;
        const roll = game.lastDiceRoll;

        // Rule: Need a 6 to leave the base
        if (token.position === 0) {
            if (roll !== 6) throw new Error('You need a 6 to move a token out of base');
            token.position = 1;
        } else {
            // Rule: Cannot overshoot Home (57)
            if (token.position + roll > 57) throw new Error('Invalid move, needs exact roll to finish');
            token.position += roll;
        }

        // --- COLLISION DETECTION (Eating opponents) ---
        let capturedSomeone = false;
        if (token.position > 0 && token.position <= 51 && !this.safeZones.includes(token.position)) {
            const myGlobalPos = this.getGlobalPosition(player.color, token.position);

            // Check all other players' tokens
            for (const opponent of game.players) {
                if (opponent.userId === userId) continue;
                for (const oppToken of opponent.tokens) {
                    if (oppToken.position > 0 && oppToken.position <= 51) {
                        const oppGlobalPos = this.getGlobalPosition(opponent.color, oppToken.position);
                        if (myGlobalPos === oppGlobalPos) {
                            // KAPOW! Send opponent back to base
                            oppToken.position = 0;
                            capturedSomeone = true;
                        }
                    }
                }
            }
        }

        // CHECK WIN CONDITION
        const hasWon = player.tokens.every(t => t.position === 57);
        if (hasWon) return { game, winnerId: userId };

        // IF they rolled a 6 OR captured someone, they get to roll again!
        if (roll === 6 || capturedSomeone) {
            game.hasRolled = false;
            game.lastDiceRoll = null;
        } else {
            this.nextTurn(game);
        }

        return { game, winnerId: null };
    }

    // Helper: Converts a player's relative position to the 52-square global board
    private getGlobalPosition(color: LudoColor, relativePos: number): number {
        const startOffsets = { 'RED': 0, 'GREEN': 13, 'YELLOW': 26, 'BLUE': 39 };
        return (relativePos - 1 + startOffsets[color]) % 52;
    }

    private nextTurn(game: LudoGameState) {
        const currentIndex = game.players.findIndex(p => p.userId === game.currentTurnUserId);
        game.currentTurnUserId = game.players[(currentIndex + 1) % game.players.length].userId;
        game.hasRolled = false;
        game.lastDiceRoll = null;
    }
}