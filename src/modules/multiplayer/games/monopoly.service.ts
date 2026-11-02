import { Injectable } from '@nestjs/common';

export type SpaceType = 'GO' | 'PROPERTY' | 'TAX' | 'CHANCE' | 'JAIL' | 'GO_TO_JAIL' | 'FREE_PARKING';

export interface BoardSpace {
    index: number;
    name: string;
    type: SpaceType;
    cost?: number;
    rent?: number;
    ownerId?: string | null;
}

export interface MonopolyPlayer {
    userId: string;
    cash: number;
    position: number;
    inJail: boolean;
    isBankrupt: boolean;
}

export interface MonopolyGameState {
    matchId: string;
    players: MonopolyPlayer[];
    board: BoardSpace[];
    currentTurnUserId: string;
    hasRolled: boolean;
    lastDiceRoll: [number, number] | null;
    turnLog: string;
}

@Injectable()
export class MonopolyService {
    private activeGames = new Map<string, MonopolyGameState>();

    private generateBoard(): BoardSpace[] {
        return [
            { index: 0, name: 'GO', type: 'GO' },
            { index: 1, name: 'Iddo', type: 'PROPERTY', cost: 60, rent: 20, ownerId: null },
            { index: 2, name: 'Community Chest', type: 'CHANCE' },
            { index: 3, name: 'Ajegunle', type: 'PROPERTY', cost: 60, rent: 25, ownerId: null },
            { index: 4, name: 'Income Tax', type: 'TAX', cost: 150 },
            { index: 5, name: 'Murtala Muhammed Airport', type: 'PROPERTY', cost: 200, rent: 75, ownerId: null },
            { index: 6, name: 'Yaba', type: 'PROPERTY', cost: 100, rent: 35, ownerId: null },
            { index: 7, name: 'Chance', type: 'CHANCE' },
            { index: 8, name: 'Surulere', type: 'PROPERTY', cost: 100, rent: 35, ownerId: null },
            { index: 9, name: 'Ikeja', type: 'PROPERTY', cost: 120, rent: 45, ownerId: null },
            { index: 10, name: 'Kirikiri Prison (Just Visiting)', type: 'JAIL' },
            { index: 11, name: 'Festac Town', type: 'PROPERTY', cost: 140, rent: 50, ownerId: null },
            { index: 12, name: 'NEPA / PHCN', type: 'PROPERTY', cost: 150, rent: 60, ownerId: null },
            { index: 13, name: 'Gbagada', type: 'PROPERTY', cost: 140, rent: 50, ownerId: null },
            { index: 14, name: 'Maryland', type: 'PROPERTY', cost: 160, rent: 60, ownerId: null },
            { index: 15, name: 'Nnamdi Azikiwe Airport', type: 'PROPERTY', cost: 200, rent: 75, ownerId: null },
            { index: 16, name: 'Magodo', type: 'PROPERTY', cost: 180, rent: 70, ownerId: null },
            { index: 17, name: 'Community Chest', type: 'CHANCE' },
            { index: 18, name: 'Ogba', type: 'PROPERTY', cost: 180, rent: 70, ownerId: null },
            { index: 19, name: 'Oniru', type: 'PROPERTY', cost: 200, rent: 80, ownerId: null },
            { index: 20, name: 'Free Parking', type: 'FREE_PARKING' },
            { index: 21, name: 'Ajah', type: 'PROPERTY', cost: 220, rent: 90, ownerId: null },
            { index: 22, name: 'Chance', type: 'CHANCE' },
            { index: 23, name: 'Chevron', type: 'PROPERTY', cost: 220, rent: 90, ownerId: null },
            { index: 24, name: 'Lekki Phase 1', type: 'PROPERTY', cost: 240, rent: 100, ownerId: null },
            { index: 25, name: 'Port Harcourt Airport', type: 'PROPERTY', cost: 200, rent: 75, ownerId: null },
            { index: 26, name: 'Gwarinpa (Abuja)', type: 'PROPERTY', cost: 260, rent: 110, ownerId: null },
            { index: 27, name: 'Wuse II (Abuja)', type: 'PROPERTY', cost: 260, rent: 110, ownerId: null },
            { index: 28, name: 'Water Works', type: 'PROPERTY', cost: 150, rent: 60, ownerId: null },
            { index: 29, name: 'Asokoro (Abuja)', type: 'PROPERTY', cost: 280, rent: 120, ownerId: null },
            { index: 30, name: 'Go To Jail', type: 'GO_TO_JAIL' },
            { index: 31, name: 'Maitama (Abuja)', type: 'PROPERTY', cost: 300, rent: 130, ownerId: null },
            { index: 32, name: 'Victoria Island', type: 'PROPERTY', cost: 300, rent: 130, ownerId: null },
            { index: 33, name: 'Community Chest', type: 'CHANCE' },
            { index: 34, name: 'Ikoyi', type: 'PROPERTY', cost: 320, rent: 150, ownerId: null },
            { index: 35, name: 'Kano Airport', type: 'PROPERTY', cost: 200, rent: 75, ownerId: null },
            { index: 36, name: 'Chance', type: 'CHANCE' },
            { index: 37, name: 'Eko Atlantic', type: 'PROPERTY', cost: 350, rent: 175, ownerId: null },
            { index: 38, name: 'Luxury Tax', type: 'TAX', cost: 100 },
            { index: 39, name: 'Banana Island', type: 'PROPERTY', cost: 400, rent: 200, ownerId: null },
        ];
    }

    initializeGame(matchId: string, userIds: string[]): MonopolyGameState {
        const players: MonopolyPlayer[] = userIds.map(userId => ({
            userId,
            cash: 1500,
            position: 0,
            inJail: false,
            isBankrupt: false,
        }));

        const gameState: MonopolyGameState = {
            matchId,
            players,
            board: this.generateBoard(),
            currentTurnUserId: userIds[0]!,
            hasRolled: false,
            lastDiceRoll: null,
            turnLog: 'Game started! Roll the dice.',
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
        if (game.hasRolled) throw new Error('You already rolled this turn');

        const player = game.players.find(p => p.userId === userId);
        if (!player || player.isBankrupt) throw new Error('Invalid player');

        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const total = d1 + d2;

        game.lastDiceRoll = [d1, d2];
        game.hasRolled = true;

        if (player.inJail) {
            if (d1 === d2) {
                player.inJail = false;
                game.turnLog = `Rolled doubles (${d1}, ${d2}) and escaped Kirikiri Prison!`;
            } else {
                player.cash -= 50;
                player.inJail = false;
                game.turnLog = `Paid ₦50 bail to leave Kirikiri Prison.`;
            }
        }

        const oldPos = player.position;
        player.position = (player.position + total) % 40;

        if (player.position < oldPos && !player.inJail) {
            player.cash += 200;
            game.turnLog = `Passed GO and collected ₦200! `;
        } else {
            game.turnLog = '';
        }

        const space = game.board[player.position]!;

        if (space.type === 'GO_TO_JAIL') {
            player.position = 10;
            player.inJail = true;
            game.turnLog += `Landed on Go To Jail! Sent straight to Kirikiri Prison.`;
        } else if (space.type === 'TAX') {
            player.cash -= (space.cost || 100);
            game.turnLog += `Paid ₦${space.cost} in ${space.name}.`;
        } else if (space.type === 'CHANCE') {
            const luck = Math.random() > 0.5 ? 100 : -100;
            player.cash += luck;
            game.turnLog += luck > 0 ? `Chance: Won ₦100 lottery!` : `Chance: Paid ₦100 LASTMA fine!`;
        } else if (space.type === 'PROPERTY') {
            if (space.ownerId && space.ownerId !== userId) {
                const owner = game.players.find(p => p.userId === space.ownerId);
                if (owner && !owner.isBankrupt) {
                    const rent = space.rent || 50;
                    player.cash -= rent;
                    owner.cash += rent;
                    game.turnLog += `Landed on ${space.name} and paid ₦${rent} rent!`;
                }
            } else if (!space.ownerId) {
                game.turnLog += `Landed on ${space.name} (Available for ₦${space.cost}).`;
            }
        } else {
            game.turnLog += `Landed on ${space.name}.`;
        }

        const winnerId = this.checkBankruptcyAndWinner(game, player);
        return { game, winnerId };
    }

    buyProperty(matchId: string, userId: string) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');
        if (!game.hasRolled) throw new Error('Roll the dice first');

        const player = game.players.find(p => p.userId === userId);
        if (!player) throw new Error('Player not found');

        const space = game.board[player.position]!;
        if (space.type !== 'PROPERTY') throw new Error('This space cannot be bought');
        if (space.ownerId) throw new Error('Property is already owned');
        if (player.cash < (space.cost || 0)) throw new Error('Insufficient cash to buy this property');

        player.cash -= (space.cost || 0);
        space.ownerId = userId;
        game.turnLog = `Purchased ${space.name} for ₦${space.cost}!`;

        return { game };
    }

    endTurn(matchId: string, userId: string) {
        const game = this.activeGames.get(matchId);
        if (!game || game.currentTurnUserId !== userId) throw new Error('Not your turn');
        if (!game.hasRolled) throw new Error('You must roll the dice before ending your turn');

        this.nextTurn(game);
        return { game };
    }

    private checkBankruptcyAndWinner(game: MonopolyGameState, currentPlayer: MonopolyPlayer): string | null {
        if (currentPlayer.cash < 0) {
            currentPlayer.isBankrupt = true;
            game.turnLog += ` Player went BANKRUPT!`;

            for (const space of game.board) {
                if (space.ownerId === currentPlayer.userId) {
                    space.ownerId = null;
                }
            }
        }

        const activePlayers = game.players.filter(p => !p.isBankrupt);
        if (activePlayers.length === 1) {
            return activePlayers[0]!.userId;
        }

        if (currentPlayer.isBankrupt) {
            this.nextTurn(game);
        }

        return null;
    }

    private nextTurn(game: MonopolyGameState) {
        const activePlayers = game.players.filter(p => !p.isBankrupt);
        if (activePlayers.length <= 1) return;

        let currentIndex = game.players.findIndex(p => p.userId === game.currentTurnUserId);

        for (let i = 1; i <= game.players.length; i++) {
            const nextPlayer = game.players[(currentIndex + i) % game.players.length]!;
            if (!nextPlayer.isBankrupt) {
                game.currentTurnUserId = nextPlayer.userId;
                break;
            }
        }

        game.hasRolled = false;
        game.lastDiceRoll = null;
    }
}