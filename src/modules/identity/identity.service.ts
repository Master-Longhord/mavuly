import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class IdentityService {
    constructor(private prisma: PrismaService) { }

    async getProfile(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                role: true,
                accountType: true,
                name: true,
                studioName: true,
                phone: true,
                country: true,
                dob: true,
                notifications: true,
                legalName: true,
                bankName: true,
                accountNumber: true,
                accountName: true,
                withdrawalVerified: true,
                developerVerified: true,
                coinBalance: true,
                escrowBalance: true,
                createdAt: true,
            },
        });

        if (!user) throw new NotFoundException('User profile not found');
        return user;
    }

    async updateProfile(userId: string, dto: UpdateProfileDto) {
        const updateData: any = { ...dto };
        if (dto.dob) {
            updateData.dob = new Date(dto.dob);
        }
        return this.prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                name: true,
                studioName: true,
                phone: true,
                country: true,
                dob: true,
                notifications: true,
            },
        });
    }

    async claimDailyReward(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        if (user.lastDailyClaim) {
            const lastClaimDate = new Date(user.lastDailyClaim);
            lastClaimDate.setUTCHours(0, 0, 0, 0);

            if (lastClaimDate.getTime() === today.getTime()) {
                throw new ForbiddenException('You have already claimed your daily reward today. Come back tomorrow!');
            }
        }

        return this.prisma.$transaction(async (tx) => {
            const updatedUser = await tx.user.update({
                where: { id: userId },
                data: {
                    coinBalance: { increment: 20 },
                    lastDailyClaim: new Date(),
                },
                select: { coinBalance: true, lastDailyClaim: true },
            });

            await tx.transaction.create({
                data: {
                    userId,
                    amount: 20,
                    type: 'REWARD',
                    status: 'COMPLETED',
                    reference: `DAILY-${Date.now()}-${userId}`,
                    description: 'Daily login bonus',
                },
            });

            return {
                message: 'Daily reward claimed successfully!',
                coinsAwarded: 20,
                newBalance: updatedUser.coinBalance,
            };
        });
    }
}