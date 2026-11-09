import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameType, MatchStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { pickBotName } from '../arcade/utils/ghost-bot.util';

@Injectable()
export class MultiplayerService {
    constructor(private prisma: PrismaService) { }

    private generateRoomCode(): string {
        return crypto.randomBytes(3).toString('hex').toUpperCase();
    }

    async getRoomInfo(roomCode: string) {
        const match = await this.prisma.multiplayerMatch.findUnique({
            where: { roomCode: roomCode.toUpperCase() },
            include: { participants: { include: { user: { select: { name: true } } } } }
        });
        if (!match) throw new NotFoundException('Room not found');
        return match;
    }

    async createPrivateRoom(userId: string, gameType: GameType, stakeAmount: number, maxPlayers: number) {
        if (stakeAmount < 10) throw new BadRequestException('Minimum stake is 10 coins');

        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user || user.coinBalance < stakeAmount) {
                throw new BadRequestException('Insufficient coins to create room');
            }

            await tx.user.update({
                where: { id: userId },
                data: { coinBalance: { decrement: stakeAmount } }
            });

            const roomCode = this.generateRoomCode();

            return tx.multiplayerMatch.create({
                data: {
                    gameType,
                    stakeAmount,
                    prizePool: stakeAmount,
                    maxPlayers,
                    roomCode,
                    hostId: userId,
                    status: MatchStatus.WAITING_OPPONENT,
                    participants: {
                        create: [{ userId }]
                    }
                },
                include: { participants: { include: { user: { select: { name: true } } } } }
            });
        });
    }

    async joinRoom(userId: string, roomCode: string, expectedStake?: number) {
        return this.prisma.$transaction(async (tx) => {
            const match = await tx.multiplayerMatch.findUnique({
                where: { roomCode: roomCode.toUpperCase() },
                include: { participants: { include: { user: { select: { name: true } } } } }
            });

            if (!match) throw new NotFoundException('Room not found');
            if (expectedStake !== undefined && match.stakeAmount !== expectedStake) {
                throw new BadRequestException(`Stake mismatch. Room stake is ${match.stakeAmount} coins.`);
            }
            if (match.status !== MatchStatus.WAITING_OPPONENT) {
                throw new BadRequestException('Game has already started or is closed');
            }
            if (match.participants.length >= match.maxPlayers) {
                throw new BadRequestException('Room is full');
            }
            if (match.participants.some(p => p.userId === userId)) {
                return match;
            }

            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user || user.coinBalance < match.stakeAmount) {
                throw new BadRequestException('Insufficient coins to join room');
            }

            await tx.user.update({
                where: { id: userId },
                data: { coinBalance: { decrement: match.stakeAmount } }
            });

            return tx.multiplayerMatch.update({
                where: { id: match.id },
                data: {
                    prizePool: { increment: match.stakeAmount },
                    participants: { create: [{ userId }] }
                },
                include: { participants: { include: { user: { select: { name: true } } } } }
            });
        });
    }

    async quickMatch(userId: string, gameType: GameType, stakeAmount: number, maxPlayers: number, vsBot?: boolean) {
        if (vsBot) {
            return { match: await this.createPrivateRoom(userId, gameType, stakeAmount, maxPlayers), isNew: true };
        }

        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        const openRooms = await this.prisma.multiplayerMatch.findMany({
            where: {
                gameType,
                stakeAmount,
                maxPlayers,
                status: MatchStatus.WAITING_OPPONENT,
                createdAt: { gte: tenMinsAgo }
            },
            include: { participants: true },
            orderBy: { createdAt: 'asc' }
        });

        const availableRoom = openRooms.find(
            r => r.participants.length < r.maxPlayers && !r.participants.some(p => p.userId === userId)
        );

        if (availableRoom) {
            return { match: await this.joinRoom(userId, availableRoom.roomCode, stakeAmount), isNew: false };
        } else {
            return { match: await this.createPrivateRoom(userId, gameType, stakeAmount, maxPlayers), isNew: true };
        }
    }

    async leaveLobbyAndRefund(userId: string, matchId: string) {
        return this.prisma.$transaction(async (tx) => {
            const match = await tx.multiplayerMatch.findUnique({
                where: { id: matchId },
                include: { participants: true }
            });

            if (!match) throw new NotFoundException('Match not found');

            if (match.status === MatchStatus.PLAYING) {
                const remaining = match.participants.filter(p => p.userId !== userId);
                if (remaining.length >= 1) {
                    const winnerId = remaining[0]!.userId;
                    const result = await this.settleGame(matchId, winnerId);
                    return { forfeited: true, winnerId, prize: result.winnerPrize };
                } else {
                    const result = await this.settleGame(matchId, 'bot_forfeit_winner');
                    return { forfeited: true, winnerId: 'bot_forfeit_winner', prize: result.winnerPrize };
                }
            }

            if (match.status !== MatchStatus.WAITING_OPPONENT) {
                throw new BadRequestException('Room is already closed');
            }

            if (match.hostId === userId) {
                for (const p of match.participants) {
                    await tx.user.update({
                        where: { id: p.userId },
                        data: { coinBalance: { increment: match.stakeAmount } }
                    });
                }
                await tx.multiplayerMatch.update({
                    where: { id: matchId },
                    data: { status: MatchStatus.EXPIRED_REFUNDED, prizePool: 0 }
                });
                return { cancelled: true, message: 'Host left. Room closed and all players refunded.' };
            } else {
                const isParticipant = match.participants.some(p => p.userId === userId);
                if (!isParticipant) throw new BadRequestException('Not in this room');

                await tx.matchParticipant.delete({
                    where: { matchId_userId: { matchId, userId } }
                });
                await tx.user.update({
                    where: { id: userId },
                    data: { coinBalance: { increment: match.stakeAmount } }
                });
                const updatedMatch = await tx.multiplayerMatch.update({
                    where: { id: matchId },
                    data: { prizePool: { decrement: match.stakeAmount } },
                    include: { participants: { include: { user: { select: { name: true } } } } }
                });
                return { cancelled: false, match: updatedMatch };
            }
        });
    }

    async startGame(userId: string, roomId: string) {
        const match = await this.prisma.multiplayerMatch.findUnique({
            where: { id: roomId },
            include: { participants: { include: { user: { select: { name: true } } } } }
        });

        if (!match) throw new NotFoundException('Match not found');
        if (match.hostId !== userId) throw new BadRequestException('Only the host can start the game');
        if (match.status !== MatchStatus.WAITING_OPPONENT) throw new BadRequestException('Game already started');

        const needsBotFill = match.participants.length === 1;
        const effectivePrizePool = needsBotFill ? match.stakeAmount * 2 : match.prizePool;

        const updatedMatch = await this.prisma.multiplayerMatch.update({
            where: { id: roomId },
            data: {
                status: MatchStatus.PLAYING,
                prizePool: effectivePrizePool
            },
            include: { participants: { include: { user: { select: { name: true } } } } }
        });

        const allParticipants: any[] = [...updatedMatch.participants];

        if (needsBotFill) {
            const botsToCreate = Math.max(1, updatedMatch.maxPlayers - allParticipants.length);
            const usedNames = new Set<string>();
            for (let i = 0; i < botsToCreate; i++) {
                let botName = pickBotName();
                while (usedNames.has(botName)) {
                    botName = pickBotName();
                }
                usedNames.add(botName);
                const botUserId = `bot_${i + 1}_${botName}`;
                allParticipants.push({
                    id: `bot_part_${i + 1}`,
                    matchId: roomId,
                    userId: botUserId,
                    isBot: true,
                    user: { name: botName }
                });
            }
        }

        return {
            ...updatedMatch,
            participants: allParticipants
        };
    }

    async settleGame(roomId: string, winnerId: string) {
        return this.prisma.$transaction(async (tx) => {
            const match = await tx.multiplayerMatch.findUnique({ where: { id: roomId } });
            if (!match) throw new NotFoundException('Match not found');

            const isBotWinner = winnerId.startsWith('bot_');

            if (match.status === MatchStatus.SETTLED) {
                const existingPrize = isBotWinner ? 0 : match.prizePool - Math.floor(match.prizePool * 0.15);
                return { winnerPrize: existingPrize, isBotWinner };
            }

            if (isBotWinner) {
                await tx.multiplayerMatch.update({
                    where: { id: roomId },
                    data: { status: 'SETTLED', winnerId: null, updatedAt: new Date() }
                });

                await tx.transaction.create({
                    data: {
                        userId: match.hostId,
                        amount: match.stakeAmount,
                        type: 'PLATFORM_PROFIT',
                        status: 'COMPLETED',
                        reference: `MULTI-BOTWIN-${roomId}`,
                        description: `Bot won multiplayer ${match.gameType} match`,
                    }
                });

                return { winnerPrize: 0, isBotWinner: true };
            }

            const platformRake = Math.floor(match.prizePool * 0.15);
            const winnerPrize = match.prizePool - platformRake;

            await tx.multiplayerMatch.update({
                where: { id: roomId },
                data: { status: 'SETTLED', winnerId, updatedAt: new Date() }
            });

            await tx.user.update({
                where: { id: winnerId },
                data: { coinBalance: { increment: winnerPrize } }
            });

            await tx.transaction.create({
                data: {
                    userId: winnerId,
                    amount: winnerPrize,
                    type: 'PVP_WIN',
                    status: 'COMPLETED',
                    reference: `MULTI-WIN-${roomId}`,
                }
            });

            return { winnerPrize, isBotWinner: false };
        });
    }
}