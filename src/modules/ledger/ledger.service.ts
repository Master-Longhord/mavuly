import { Injectable, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
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

        const usdAmount = dto.amount * this.KUDICOIN_TO_USD_RATE;
        const ngnAmount = Math.floor(usdAmount * this.USD_TO_NGN_RATE);
        const reference = `WD-${Date.now()}-${uuidv4().substring(0, 8)}`;
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
            await this.prisma.$transaction([
                this.prisma.user.update({
                    where: { id: userId },
                    data: { coinBalance: { increment: dto.amount } },
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
        return transactions.map((tx) => {
            const isPositive = ['REWARD', 'PVP_WIN'].includes(tx.type);

            return {
                id: tx.id,
                date: tx.createdAt,
                description: tx.description || tx.type,
                amount: isPositive ? Number(tx.amount) : -Number(tx.amount),
                status: tx.status,
                type: tx.type,
            };
        });
    }

    async handleFlutterwaveWebhook(signature: string, payload: any) {
        // 1. Verify the webhook actually came from Flutterwave
        const secretHash = this.configService.get<string>('FLUTTERWAVE_WEBHOOK_SECRET');
        if (signature !== secretHash) {
            throw new BadRequestException('Invalid webhook signature');
        }

        // 2. We only care about successful payments
        if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
            const amountPaid = payload.data.amount;
            const userEmail = payload.data.customer.email;
            const txRef = payload.data.tx_ref; // Unique reference from the frontend

            // 3. Prevent processing the same transaction twice
            const existingTx = await this.prisma.escrowTransaction.findUnique({
                where: { reference: txRef }
            });
            if (existingTx) return { message: 'Transaction already processed' };

            // 4. Find the Developer by the email they used to pay
            const developer = await this.prisma.user.findUnique({ where: { email: userEmail } });
            if (!developer) throw new NotFoundException('Developer not found for this payment');

            // 5. ATOMIC TRANSACTION: Add money to Escrow and Log it
            await this.prisma.$transaction(async (tx) => {
                // Increment their global escrow balance
                await tx.user.update({
                    where: { id: developer.id },
                    data: { escrowBalance: { increment: amountPaid } }
                });

                // Log the Escrow Deposit
                await tx.escrowTransaction.create({
                    data: {
                        developerId: developer.id,
                        amount: amountPaid,
                        type: 'DEPOSIT', // EscrowTxType.DEPOSIT
                        status: 'COMPLETED',
                        reference: txRef,
                        metadata: payload.data, // Save Flutterwave's raw data just in case
                    }
                });
            });

            return { status: 'success' };
        }

        // If it was a failed payment or different event, just ignore it and return 200 OK to Flutterwave
        return { status: 'ignored' };
    }
}