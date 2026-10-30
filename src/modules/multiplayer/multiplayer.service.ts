import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameType, MatchStatus } from '@prisma/client';
import * as crypto from 'crypto';

@Injectable()
export class MultiplayerService {
    constructor(private prisma: PrismaService) { }

    private generateRoomCode(): string {
        return crypto.randomBytes(3).toString('hex').toUpperCase();
    }

    async createPrivateRoom(userId: string, gameType: GameType, stakeAmount: number, maxPlayers: number) {
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

    async joinRoom(userId: string, roomCode: string) {
        return this.prisma.$transaction(async (tx) => {
            const match = await tx.multiplayerMatch.findUnique({
                where: { roomCode },
                include: { participants: true }
            });

            if (!match) throw new NotFoundException('Room not found');
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

            const updatedMatch = await tx.multiplayerMatch.update({
                where: { id: match.id },
                data: { prizePool: { increment: match.stakeAmount } },
                include: { participants: { include: { user: { select: { name: true } } } } }
            });

            await tx.matchParticipant.create({
                data: { matchId: match.id, userId }
            });

            return updatedMatch;
        });
    }

    async startGame(userId: string, roomId: string) {
        const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: roomId } });

        if (!match) throw new NotFoundException('Match not found');
        if (match.hostId !== userId) throw new BadRequestException('Only the host can start the game');
        if (match.status !== MatchStatus.WAITING_OPPONENT) throw new BadRequestException('Game already started');

        return this.prisma.multiplayerMatch.update({
            where: { id: roomId },
            data: { status: MatchStatus.PLAYING },
            include: { participants: true }
        });
    }

    async settleGame(roomId: string, winnerId: string) {
        return this.prisma.$transaction(async (tx) => {
            const match = await tx.multiplayerMatch.findUnique({ where: { id: roomId } });
            if (!match) throw new NotFoundException('Match not found');

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
                    reference: `WHOT-WIN-${roomId}`,
                }
            });

            return { winnerPrize };
        });
    }
}