import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MatchStatus, TransactionType } from '@prisma/client';

@Injectable()
export class AdminService {
    constructor(private prisma: PrismaService) { }

    // 1. DASHBOARD STATS
    async getDashboardStats() {
        const totalUsers = await this.prisma.user.count();
        const activeTesters = await this.prisma.user.count({ where: { accountType: 'TESTER', isActive: true } });
        const activeCampaigns = await this.prisma.campaign.count({ where: { status: 'ACTIVE' } });
        const pendingKyc = await this.prisma.user.count({ where: { kycStatus: 'PENDING' } });
        const openDisputes = await this.prisma.ticket.count({ where: { status: 'OPEN' } });

        // Total Payouts (Money successfully withdrawn by users)
        const payoutsAgg = await this.prisma.transaction.aggregate({
            where: { type: TransactionType.WITHDRAWAL, status: 'COMPLETED' },
            _sum: { amount: true },
        });
        const totalPayouts = Number(payoutsAgg._sum?.amount || 0);

        // Platform Revenue (15% Rake collected from Games & Bot wins)
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

    // 2. USERS LIST
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
                isActive: true,
                createdAt: true,
            },
        });
    }

    // 3. CAMPAIGNS LIST
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

    // 4. PAYOUTS LIST (Withdrawals)
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

        // Format to match exactly what the frontend asked for
        return payouts.map(p => ({
            id: p.id,
            testerName: p.user?.name || 'Unknown',
            email: p.user?.email || 'Unknown',
            amount: p.amount,
            method: 'Flutterwave Bank Transfer', // Since this is our only payout method currently
            status: p.status,
            createdDate: p.createdAt,
        }));
    }

    // 5. DISPUTES / TICKETS LIST
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
            priority: t.category === 'Payments' ? 'High' : 'Normal', // Auto-assign priority based on category for the UI
            createdDate: t.createdAt,
        }));
    }
}