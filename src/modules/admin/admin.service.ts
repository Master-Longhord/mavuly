import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TransactionType } from '@prisma/client';

@Injectable()
export class AdminService {
    constructor(private prisma: PrismaService) { }

    async getDashboardStats() {
        const totalUsers = await this.prisma.user.count();
        const activeTesters = await this.prisma.user.count({ where: { accountType: 'TESTER', isActive: true } });
        const activeCampaigns = await this.prisma.campaign.count({ where: { status: 'ACTIVE' } });
        const pendingKyc = await this.prisma.user.count({ where: { kycStatus: 'PENDING' } });
        const openDisputes = await this.prisma.ticket.count({ where: { status: 'OPEN' } });

        const payoutsAgg = await this.prisma.transaction.aggregate({
            where: { type: TransactionType.WITHDRAWAL, status: 'COMPLETED' },
            _sum: { amount: true },
        });
        const totalPayouts = Number(payoutsAgg._sum?.amount || 0);

        const revenueAgg = await this.prisma.transaction.aggregate({
            where: { type: TransactionType.PLATFORM_PROFIT, status: 'COMPLETED' },
            _sum: { amount: true },
        });
        const platformRevenue = Number(revenueAgg._sum?.amount || 0);

        return {
            totalUsers,
            activeTesters,
            activeCampaigns,
            totalPayouts,
            pendingKyc,
            openDisputes,
            platformRevenue,
        };
    }

    async getAllUsers() {
        return this.prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                email: true,
                accountType: true,
                country: true,
                kycStatus: true,
                developerVerified: true,
                coinBalance: true,
                escrowBalance: true,
                referralCode: true,
                referredBy: { select: { id: true, name: true, referralCode: true } },
                _count: { select: { referrals: true } },
                isActive: true,
                createdAt: true,
            },
        });
    }

    async getReferralLeaderboard() {
        const usersWithReferrals = await this.prisma.user.findMany({
            where: {
                referrals: { some: {} },
            },
            select: {
                id: true,
                name: true,
                studioName: true,
                email: true,
                accountType: true,
                referralCode: true,
                referrals: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        isEmailVerified: true,
                        createdAt: true,
                    },
                },
            },
        });

        return usersWithReferrals
            .map(u => {
                const verifiedReferrals = u.referrals.filter(r => r.isEmailVerified).length;
                return {
                    id: u.id,
                    name: u.studioName || u.name,
                    email: u.email,
                    accountType: u.accountType,
                    referralCode: u.referralCode,
                    referralLink: u.referralCode ? `https://mavuly.com/register?ref=${u.referralCode}` : null,
                    totalReferrals: u.referrals.length,
                    verifiedReferrals,
                    coinsEarned: verifiedReferrals * 100,
                    referredUsers: u.referrals,
                };
            })
            .sort((a, b) => b.totalReferrals - a.totalReferrals);
    }

    async getAllCampaigns() {
        return this.prisma.campaign.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                title: true,
                appName: true,
                developer: { select: { name: true, studioName: true } },
                status: true,
                targetTesters: true,
                completedTesters: true,
                rewardPerTask: true,
                createdAt: true,
            },
        });
    }

    async getAllPayouts() {
        const payouts = await this.prisma.transaction.findMany({
            where: { type: TransactionType.WITHDRAWAL },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                amount: true,
                status: true,
                createdAt: true,
                user: { select: { name: true, email: true } },
            },
        });

        return payouts.map(p => ({
            id: p.id,
            testerName: p.user?.name || 'Unknown',
            email: p.user?.email || 'Unknown',
            amount: p.amount,
            method: 'Flutterwave Bank Transfer',
            status: p.status,
            createdDate: p.createdAt,
        }));
    }

    async getAllDisputes() {
        const tickets = await this.prisma.ticket.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                subject: true,
                status: true,
                category: true,
                createdAt: true,
                user: { select: { name: true, email: true } },
            },
        });

        return tickets.map(t => ({
            id: t.id,
            user: t.user?.name || t.user?.email || 'Unknown',
            subject: t.subject,
            status: t.status,
            priority: t.category === 'Payments' ? 'High' : 'Normal',
            createdDate: t.createdAt,
        }));
    }
}