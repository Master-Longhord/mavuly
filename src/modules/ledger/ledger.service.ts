import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WithdrawDto } from './dto/withdraw.dto';
import { KycStatus, TransactionStatus, TransactionType } from '@prisma/client';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class LedgerService {
    private readonly KUDICOIN_TO_USD_RATE = 0.001; // 1,000 Coins = $1.00
    private readonly USD_TO_NGN_RATE = 1350; // Simulated Exchange Rate: $1 = ₦1,500
    private readonly FLW_BASE_URL = 'https://api.flutterwave.com/v3';

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) { }

    async requestWithdrawal(userId: string, dto: WithdrawDto) {
        // 1. Fetch user and their verified bank account
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { bankAccount: true },
        });

        if (!user) throw new BadRequestException('User not found');
        if (user.kycStatus !== KycStatus.VERIFIED || !user.bankAccount) {
            throw new BadRequestException('You must verify your bank account before withdrawing.');
        }
        if (user.coinBalance < dto.amount) {
            throw new BadRequestException('Insufficient KudiCoins.');
        }

        // 2. Do the Math (Coins -> USD -> NGN)
        const usdAmount = dto.amount * this.KUDICOIN_TO_USD_RATE;
        const ngnAmount = Math.floor(usdAmount * this.USD_TO_NGN_RATE);
        const reference = `WD-${Date.now()}-${uuidv4().substring(0, 8)}`;

        // 3. STEP 1: Lock the funds in the database (Create PENDING transaction)
        const pendingTx = await this.prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: { coinBalance: { decrement: dto.amount } },
            });

            return tx.transaction.create({
                data: {
                    userId,
                    amount: dto.amount,
                    type: TransactionType.WITHDRAWAL,
                    status: TransactionStatus.PENDING,
                    reference,
                    description: `Withdrawal of ${dto.amount} coins (₦${ngnAmount}) to ${user.bankAccount!.bankName}`,
                },
            });
        });

        // 4. STEP 2: Call Flutterwave Transfer API
        try {
            const secretKey = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');

            const flwResponse = await axios.post(
                `${this.FLW_BASE_URL}/transfers`,
                {
                    account_bank: user.bankAccount.bankCode,
                    account_number: user.bankAccount.accountNumber,
                    amount: ngnAmount,
                    narration: 'Mavuly Payout',
                    currency: 'NGN',
                    reference: reference,
                },
                {
                    headers: {
                        Authorization: `Bearer ${secretKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            if (flwResponse.data.status !== 'success') {
                throw new Error('Flutterwave returned non-success status');
            }

            // 5. STEP 3 (SUCCESS): Mark transaction as COMPLETED
            await this.prisma.transaction.update({
                where: { id: pendingTx.id },
                data: { status: TransactionStatus.COMPLETED },
            });

            return {
                message: 'Withdrawal successful! Funds are on the way.',
                coinsDeducted: dto.amount,
                fiatAmount: `₦${ngnAmount}`,
                status: 'COMPLETED',
            };

        } catch (error: any) {
            // 6. STEP 3 (FAIL): Refund the user and mark FAILED
            await this.prisma.$transaction([
                this.prisma.user.update({
                    where: { id: userId },
                    data: { coinBalance: { increment: dto.amount } }, // Refund!
                }),
                this.prisma.transaction.update({
                    where: { id: pendingTx.id },
                    data: { status: TransactionStatus.FAILED, description: 'Withdrawal failed. Coins refunded.' },
                }),
            ]);

            throw new InternalServerErrorException(
                `Withdrawal failed. Your coins have been refunded. Reason: ${error.response?.data?.message || error.message
                }`
            );
        }
    }

    async getTransactionHistory(userId: string) {
        const transactions = await this.prisma.transaction.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }, // Newest first
            select: {
                id: true,
                amount: true,
                type: true,
                status: true,
                description: true,
                createdAt: true,
            },
        });

        // Map the database records to exactly what the frontend UI expects
        return transactions.map((tx) => {
            // Determine if the transaction added or removed coins
            const isPositive = ['REWARD', 'PVP_WIN'].includes(tx.type);

            return {
                id: tx.id,
                date: tx.createdAt,
                description: tx.description || tx.type,
                // Send a positive or negative number based on the transaction type
                amount: isPositive ? Number(tx.amount) : -Number(tx.amount),
                status: tx.status,
                type: tx.type,
            };
        });
    }
}