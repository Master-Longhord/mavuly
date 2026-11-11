import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameType, MatchStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { pickBotName } from '../arcade/utils/ghost-bot.util';

export const ROOM_EXPIRY_MS = 5 * 60 * 1000;
const MAX_PLAYING_DURATION_MS = 30 * 60 * 1000;
export const MIN_STAKE = 10;
export const MAX_HUMAN_STAKE = 500;
export const MAX_BOT_STAKE = 100;
export const MAX_DAILY_BOT_MATCHES = 10;

@Injectable()
export class MultiplayerService {
    constructor(private prisma: PrismaService) { }

    private generateRoomCode(): string {
        return crypto.randomBytes(3).toString('hex').toUpperCase();
    }

    formatMatch(match: any, extraBotParticipants: any[] = []) {
        const createdAtMs = match.createdAt ? new Date(match.createdAt).getTime() : Date.now();
        const expiresAt = new Date(createdAtMs + ROOM_EXPIRY_MS).toISOString();

        const humanParticipants = (match.participants || []).map((p: any) => ({
            ...p,
            isBot: Boolean(p.isBot)
        }));

        const allParticipants = [...humanParticipants, ...extraBotParticipants];

        return {
            ...match,
            expiresAt,
            participants: allParticipants
        };
    }

    async expireRoomAndRefund(matchId: string, allowPlayingOrphan: boolean = false) {
        return this.prisma.$transaction(async (tx) => {
            const match = await tx.multiplayerMatch.findUnique({
                where: { id: matchId },
                include: { participants: true }
            });

            if (!match) return { expired: false };

            const canExpire =
                match.status === MatchStatus.WAITING_OPPONENT ||
                (allowPlayingOrphan && match.status === MatchStatus.PLAYING);

            if (!canExpire) {
                return { expired: false };
            }

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

            return {
                expired: true,
                matchId,
                message: 'Room expired due to inactivity. Your stake has been refunded.'
            };
        });
    }

    async cleanupExpiredWaitingRooms(activeMemoryMatchIds?: Set<string>) {
        const waitingCutoff = new Date(Date.now() - ROOM_EXPIRY_MS);
        const playingCutoff = new Date(Date.now() - MAX_PLAYING_DURATION_MS);

        const staleWaiting = await this.prisma.multiplayerMatch.findMany({
            where: {
                status: MatchStatus.WAITING_OPPONENT,
                createdAt: { lt: waitingCutoff }
            },
            select: { id: true }
        });

        for (const r of staleWaiting) {
            await this.expireRoomAndRefund(r.id, false);
        }

        const playingMatches = await this.prisma.multiplayerMatch.findMany({
            where: { status: MatchStatus.PLAYING },
            select: { id: true, updatedAt: true }
        });

        for (const m of playingMatches) {
            const isTooOld = m.updatedAt < playingCutoff;
            const isMissingFromMemory = activeMemoryMatchIds ? !activeMemoryMatchIds.has(m.id) : false;
            if (isTooOld || isMissingFromMemory) {
                await this.expireRoomAndRefund(m.id, true);
            }
        }
    }

    async ensureUserHasNoActiveMatch(userId: string, activeMemoryMatchIds?: Set<string>, excludeMatchId?: string) {
        await this.cleanupExpiredWaitingRooms(activeMemoryMatchIds);

        const existingParticipations = await this.prisma.matchParticipant.findMany({
            where: {
                userId,
                ...(excludeMatchId ? { matchId: { not: excludeMatchId } } : {}),
                match: {
                    status: { in: [MatchStatus.WAITING_OPPONENT, MatchStatus.PLAYING] }
                }
            },
            include: { match: true }
        });

        for (const p of existingParticipations) {
            if (p.match.status === MatchStatus.WAITING_OPPONENT) {
                await this.leaveLobbyAndRefund(userId, p.matchId);
            } else if (p.match.status === MatchStatus.PLAYING) {
                const isAliveInMemory = activeMemoryMatchIds ? activeMemoryMatchIds.has(p.matchId) : true;
                if (!isAliveInMemory) {
                    await this.expireRoomAndRefund(p.matchId, true);
                } else {
                    throw new BadRequestException(
                        `You already have an active live game in progress (matchId: ${p.matchId}). Please finish or leave it first.`
                    );
                }
            }
        }
    }

    async checkDailyBotLimit(userId: string) {
        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);

        const botMatchesToday = await this.prisma.multiplayerMatch.count({
            where: {
                hostId: userId,
                createdAt: { gte: startOfDay },
                status: MatchStatus.SETTLED
            }
        });

        if (botMatchesToday >= MAX_DAILY_BOT_MATCHES) {
            throw new BadRequestException(`Daily bot match limit (${MAX_DAILY_BOT_MATCHES}) reached. Play with human opponents or try again tomorrow!`);
        }
    }

    async getRoomInfo(roomCode: string, activeMemoryMatchIds?: Set<string>) {
        await this.cleanupExpiredWaitingRooms(activeMemoryMatchIds);

        const match = await this.prisma.multiplayerMatch.findUnique({
            where: { roomCode: roomCode.toUpperCase() },
            include: { participants: { include: { user: { select: { name: true } } } } }
        });
        if (!match) throw new NotFoundException('Room not found');
        if (match.status === MatchStatus.EXPIRED_REFUNDED) {
            throw new BadRequestException('This room expired after 5 minutes of inactivity.');
        }
        return this.formatMatch(match);
    }

    async createPrivateRoom(
        userId: string,
        gameType: GameType,
        stakeAmount: number,
        maxPlayers: number,
        activeMemoryMatchIds?: Set<string>,
        isVsBot?: boolean
    ) {
        if (stakeAmount < MIN_STAKE) throw new BadRequestException(`Minimum stake is ${MIN_STAKE} coins`);
        const maxAllowed = isVsBot ? MAX_BOT_STAKE : MAX_HUMAN_STAKE;
        if (stakeAmount > maxAllowed) {
            throw new BadRequestException(`Maximum stake allowed is ${maxAllowed} coins`);
        }

        if (isVsBot) {
            await this.checkDailyBotLimit(userId);
        }

        await this.ensureUserHasNoActiveMatch(userId, activeMemoryMatchIds);

        const created = await this.prisma.$transaction(async (tx) => {
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

        return this.formatMatch(created);
    }

    async joinRoom(userId: string, roomCode: string, expectedStake?: number, activeMemoryMatchIds?: Set<string>) {
        const target = await this.prisma.multiplayerMatch.findUnique({
            where: { roomCode: roomCode.toUpperCase() }
        });
        if (!target) throw new NotFoundException('Room not found');

        await this.ensureUserHasNoActiveMatch(userId, activeMemoryMatchIds, target.id);

        const joined = await this.prisma.$transaction(async (tx) => {
            const match = await tx.multiplayerMatch.findUnique({
                where: { roomCode: roomCode.toUpperCase() },
                include: { participants: { include: { user: { select: { name: true } } } } }
            });

            if (!match) throw new NotFoundException('Room not found');
            if (match.status === MatchStatus.EXPIRED_REFUNDED) {
                throw new BadRequestException('This room expired after 5 minutes of inactivity.');
            }
            if (expectedStake !== undefined && match.stakeAmount !== expectedStake) {
                throw new BadRequestException(`Stake mismatch. Room stake is ${match.stakeAmount} coins.`);
            }
            if (match.status !== MatchStatus.WAITING_OPPONENT) {
                throw new BadRequestException('Game has already started or is closed');
            }
            if (match.participants.some(p => p.userId === userId)) {
                return match;
            }
            if (match.participants.length >= match.maxPlayers) {
                throw new BadRequestException('Room is full');
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

        return this.formatMatch(joined);
    }

    async quickMatch(
        userId: string,
        gameType: GameType,
        stakeAmount: number,
        maxPlayers: number,
        vsBot?: boolean,
        activeMemoryMatchIds?: Set<string>
    ) {
        if (vsBot) {
            return {
                match: await this.createPrivateRoom(userId, gameType, stakeAmount, maxPlayers, activeMemoryMatchIds, true),
                isNew: true
            };
        }

        await this.ensureUserHasNoActiveMatch(userId, activeMemoryMatchIds);

        const fiveMinsAgo = new Date(Date.now() - ROOM_EXPIRY_MS);
        const openRooms = await this.prisma.multiplayerMatch.findMany({
            where: {
                gameType,
                stakeAmount,
                maxPlayers,
                status: MatchStatus.WAITING_OPPONENT,
                createdAt: { gte: fiveMinsAgo }
            },
            include: { participants: true },
            orderBy: { createdAt: 'asc' }
        });

        const availableRoom = openRooms.find(
            r => r.participants.length < r.maxPlayers && !r.participants.some(p => p.userId === userId)
        );

        if (availableRoom) {
            return {
                match: await this.joinRoom(userId, availableRoom.roomCode, stakeAmount, activeMemoryMatchIds),
                isNew: false
            };
        } else {
            return {
                match: await this.createPrivateRoom(userId, gameType, stakeAmount, maxPlayers, activeMemoryMatchIds, false),
                isNew: true
            };
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
                return { cancelled: true, message: 'Room is already closed.' };
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
                return { cancelled: false, match: this.formatMatch(updatedMatch) };
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
        if (match.status === MatchStatus.EXPIRED_REFUNDED) {
            throw new BadRequestException('This room expired after 5 minutes of inactivity.');
        }
        if (match.status !== MatchStatus.WAITING_OPPONENT) throw new BadRequestException('Game already started');

        const needsBotFill = match.participants.length === 1;
        if (needsBotFill) {
            if (match.stakeAmount > MAX_BOT_STAKE) {
                throw new BadRequestException(`Maximum stake against a bot is ${MAX_BOT_STAKE} coins.`);
            }
            await this.checkDailyBotLimit(userId);
        }

        const effectivePrizePool = needsBotFill ? match.stakeAmount * 2 : match.prizePool;

        const updatedMatch = await this.prisma.multiplayerMatch.update({
            where: { id: roomId },
            data: {
                status: MatchStatus.PLAYING,
                prizePool: effectivePrizePool
            },
            include: { participants: { include: { user: { select: { name: true } } } } }
        });

        const botParticipants: any[] = [];

        if (needsBotFill) {
            const botsToCreate = Math.max(1, updatedMatch.maxPlayers - updatedMatch.participants.length);
            const usedNames = new Set<string>();
            for (let i = 0; i < botsToCreate; i++) {
                let botName = pickBotName();
                while (usedNames.has(botName)) {
                    botName = pickBotName();
                }
                usedNames.add(botName);
                const botUserId = `bot_${i + 1}_${botName}`;
                botParticipants.push({
                    id: `bot_part_${i + 1}`,
                    matchId: roomId,
                    userId: botUserId,
                    isBot: true,
                    user: { name: botName }
                });
            }
        }

        return this.formatMatch(updatedMatch, botParticipants);
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