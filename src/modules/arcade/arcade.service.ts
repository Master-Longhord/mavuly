import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JoinMatchDto } from './dto/join-match.dto';
import { SubmitScoreDto } from './dto/submit-score.dto';
import { generateBoardSeed, pickBotName, generateBotScore } from './utils/ghost-bot.util';
import { computeServerScore } from './utils/scoring.util';
import { GameType, MatchStatus, TransactionType } from '@prisma/client';

@Injectable()
export class ArcadeService {
    constructor(private prisma: PrismaService) { }

    async joinMatch(userId: string, dto: JoinMatchDto) {
        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user || user.coinBalance < dto.stakeAmount) {
                throw new BadRequestException('Insufficient coin balance to enter match');
            }

            await tx.user.update({
                where: { id: userId },
                data: { coinBalance: { decrement: dto.stakeAmount } },
            });

            await tx.transaction.create({
                data: {
                    userId,
                    amount: dto.stakeAmount,
                    type: TransactionType.PVP_ENTRY,
                    status: 'COMPLETED',
                    reference: `ENTRY-${Date.now()}-${userId}`,
                    description: `Entered ${dto.gameType} match`,
                },
            });

            const openMatch = await tx.arcadeMatch.findFirst({
                where: {
                    gameType: dto.gameType,
                    stakeAmount: dto.stakeAmount,
                    status: MatchStatus.WAITING_OPPONENT,
                    player1Id: { not: userId },
                },
            });

            if (openMatch) {
                const updatedMatch = await tx.arcadeMatch.update({
                    where: { id: openMatch.id },
                    data: {
                        player2Id: userId,
                        status: MatchStatus.PLAYING,
                    },
                });
                return {
                    matchId: updatedMatch.id,
                    boardSeed: updatedMatch.boardSeed,
                    role: 'player2',
                    isBotOpponent: false,
                };
            }

            const botName = pickBotName();
            const newMatch = await tx.arcadeMatch.create({
                data: {
                    gameType: dto.gameType,
                    stakeAmount: dto.stakeAmount,
                    prizeAmount: Math.floor(dto.stakeAmount * 2 * 0.85),
                    boardSeed: generateBoardSeed(),
                    player1Id: userId,
                    isBotOpponent: true,
                    botName: botName,
                    status: MatchStatus.PLAYING,
                },
            });

            return {
                matchId: newMatch.id,
                boardSeed: newMatch.boardSeed,
                role: 'player1',
                isBotOpponent: true,
                botName,
            };
        });
    }

    async submitScore(userId: string, dto: SubmitScoreDto) {
        return this.prisma.$transaction(async (tx) => {
            const match = await tx.arcadeMatch.findUnique({ where: { id: dto.matchId } });
            if (!match) throw new NotFoundException('Match not found');

            const isPlayer1 = match.player1Id === userId;
            const isPlayer2 = match.player2Id === userId;

            if (!isPlayer1 && !isPlayer2) {
                throw new ForbiddenException('You are not a participant in this match');
            }
            if (match.status === MatchStatus.SETTLED || match.status === MatchStatus.EXPIRED_REFUNDED) {
                throw new BadRequestException('Match is already closed');
            }

            const alreadySubmitted = isPlayer1 ? match.player1Score !== null : match.player2Score !== null;
            if (alreadySubmitted) {
                throw new ConflictException('Score already submitted for this match');
            }

            const { serverScore, isTampered } = computeServerScore(
                match.gameType,
                match.boardSeed,
                dto.score,
                dto.payload
            );

            if (isTampered) {
                await tx.user.update({
                    where: { id: userId },
                    data: { tamperAttemptCount: { increment: 1 } },
                });
            }

            const now = new Date();
            let updatedMatch = await tx.arcadeMatch.update({
                where: { id: match.id },
                data: isPlayer1
                    ? { player1Score: serverScore, player1CompletedAt: now }
                    : { player2Score: serverScore, player2CompletedAt: now },
            });

            // --- RECORD DAILY GAME STREAK ---
            await this.updateUserStreak(tx, userId, match.gameType);

            if (match.isBotOpponent) {
                const botScore = generateBotScore(match.gameType, serverScore);
                updatedMatch = await tx.arcadeMatch.update({
                    where: { id: match.id },
                    data: { player2Score: botScore, player2CompletedAt: now },
                });
                return this.settleMatch(tx, updatedMatch);
            }

            if (updatedMatch.player1Score !== null && updatedMatch.player2Score !== null) {
                return this.settleMatch(tx, updatedMatch);
            }

            return {
                status: MatchStatus.PLAYING,
                message: 'Score recorded. Awaiting opponent completion.',
            };
        });
    }

    private async settleMatch(tx: any, match: any) {
        const p1Score = match.player1Score;
        const p2Score = match.player2Score;
        const isTie = p1Score === p2Score;

        let winnerId = null;
        if (!isTie) {
            winnerId = p1Score > p2Score ? match.player1Id : (match.isBotOpponent ? 'ghost_bot' : match.player2Id);
        }

        await tx.arcadeMatch.update({
            where: { id: match.id },
            data: {
                status: MatchStatus.SETTLED,
                winnerId: winnerId === 'ghost_bot' ? null : winnerId,
                settledAt: new Date(),
            },
        });

        if (isTie) {
            await tx.user.update({ where: { id: match.player1Id }, data: { coinBalance: { increment: match.stakeAmount } } });
            if (!match.isBotOpponent) {
                await tx.user.update({ where: { id: match.player2Id }, data: { coinBalance: { increment: match.stakeAmount } } });
            }
            return { status: MatchStatus.SETTLED, message: 'Tie - stake refunded', winnerId: null };
        }

        if (winnerId === 'ghost_bot') {
            return { status: MatchStatus.SETTLED, message: 'The bot won this round', winnerId: 'ghost_bot', opponentScore: p2Score };
        }

        await tx.user.update({
            where: { id: winnerId },
            data: { coinBalance: { increment: match.prizeAmount } },
        });

        await tx.transaction.create({
            data: {
                userId: winnerId,
                amount: match.prizeAmount,
                type: TransactionType.PVP_WIN,
                status: 'COMPLETED',
                reference: `WIN-${match.id}-${winnerId}`,
                description: `Won ${match.gameType} match`,
            },
        });

        return {
            status: MatchStatus.SETTLED,
            message: 'You won!',
            winnerId,
            prize: match.prizeAmount,
            opponentScore: winnerId === match.player1Id ? p2Score : p1Score
        };
    }

    // --- AUTOMATED STREAK HELPER ---
    private async updateUserStreak(tx: any, userId: string, gameType: GameType) {
        const today = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) return;

        const sameDay = user.lastStreakDate === today;

        const matchesToday = (sameDay ? user.matchesPlayedToday : 0) + 1;
        const mathMatchesToday = (sameDay ? user.mathMatchesToday : 0) + (gameType === GameType.MATH_DUEL ? 1 : 0);
        const tileMatchesToday = (sameDay ? user.tileMatchesToday : 0) + (gameType === GameType.TILE_MATCH ? 1 : 0);

        let newStreak = user.streakDays;
        if (!sameDay) {
            if (user.lastStreakDate) {
                const lastDate = new Date(user.lastStreakDate);
                const currentDate = new Date(today);
                const diffDays = Math.round((currentDate.getTime() - lastDate.getTime()) / 86400000);
                newStreak = diffDays === 1 ? newStreak + 1 : 1; // Increment if consecutive, otherwise reset
            } else {
                newStreak = 1;
            }
        }

        await tx.user.update({
            where: { id: userId },
            data: {
                streakDays: newStreak,
                lastStreakDate: today,
                matchesPlayedToday: matchesToday,
                mathMatchesToday: mathMatchesToday,
                tileMatchesToday: tileMatchesToday,
            },
        });
    }
}