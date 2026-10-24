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
    private readonly FLW_BASE_URL = 'https://api.flutterwave.com/v3';

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
    ) { }

    // --- DYNAMIC EXCHANGE RATE ENGINE ---
    private async getLiveExchangeRate(): Promise<number> {
        try {
            const response = await axios.get('https://api.exchangerate-api.com/v4/latest/USD');
            if (response.data && response.data.rates && response.data.rates.NGN) {
                return response.data.rates.NGN;
            }
        } catch (e) {
            const error = e as any;
            console.error('Failed to fetch live exchange rate, falling back to ENV default.', error.message);
        }

        return Number(this.configService.get<number>('DEFAULT_USD_NGN_RATE')) || 1500;
    }

    async convertCoinsToDollars(userId: string, coinsToConvert: number) {
        if (coinsToConvert < 1000) {
            throw new BadRequestException('Minimum conversion amount is 1,000 KudiCoins.');
        }

        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { id: userId } });
            if (!user || user.coinBalance < coinsToConvert) {
                throw new BadRequestException('Insufficient KudiCoins to convert.');
            }

            const usdReward = coinsToConvert * this.KUDICOIN_TO_USD_RATE;

            await tx.user.update({
                where: { id: userId },
                data: {
                    coinBalance: { decrement: coinsToConvert },
                    escrowBalance: { increment: usdReward } // Add to their USD wallet
                }
            });

            await tx.transaction.create({
                data: {
                    userId,
                    amount: usdReward,
                    type: TransactionType.REWARD,
                    status: TransactionStatus.COMPLETED,
                    reference: `CONVERT-${Date.now()}-${userId.substring(0, 5)}`,
                    description: `Converted ${coinsToConvert} KudiCoins to $${usdReward.toFixed(2)}`
                }
            });

            return {
                message: 'Coins successfully converted to Dollars!',
                coinsDeducted: coinsToConvert,
                usdAdded: usdReward
            };
        });
    }

    async requestWithdrawal(userId: string, dto: WithdrawDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: { bankAccount: true },
        });

        if (!user) throw new BadRequestException('User not found');
        if (user.kycStatus !== KycStatus.VERIFIED || !user.bankAccount) {
            throw new BadRequestException('You must verify your bank account before withdrawing.');
        }

        if (Number(user.escrowBalance) < dto.amount) {
            throw new BadRequestException(`Insufficient funds. You only have $${Number(user.escrowBalance).toFixed(2)}.`);
        }

        const liveRate = await this.getLiveExchangeRate();
        const ngnAmount = Math.floor(dto.amount * liveRate);
        const reference = `WD-${Date.now()}-${uuidv4().substring(0, 8)}`;

        const pendingTx = await this.prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: { escrowBalance: { decrement: dto.amount } },
            });

            return tx.transaction.create({
                data: {
                    userId,
                    amount: dto.amount,
                    type: TransactionType.WITHDRAWAL,
                    status: TransactionStatus.PENDING,
                    reference,
                    description: `Withdrawal of $${dto.amount} (₦${ngnAmount}) to ${user.bankAccount!.bankName}`,
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
                { headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' } }
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
                usdDeducted: dto.amount,
                fiatAmount: `₦${ngnAmount}`,
                exchangeRateUsed: liveRate,
                status: 'COMPLETED',
            };

        } catch (error: any) {
            // Refund the USD if it fails!
            await this.prisma.$transaction([
                this.prisma.user.update({
                    where: { id: userId },
                    data: { escrowBalance: { increment: dto.amount } },
                }),
                this.prisma.transaction.update({
                    where: { id: pendingTx.id },
                    data: { status: TransactionStatus.FAILED, description: 'Withdrawal failed. Funds refunded.' },
                }),
            ]);

            throw new InternalServerErrorException(
                `Withdrawal failed. Your funds have been refunded. Reason: ${error.response?.data?.message || error.message}`
            );
        }
    }

    // --- 3. TRANSACTION HISTORY ---
    async getTransactionHistory(userId: string) {
        const transactions = await this.prisma.transaction.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
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
            const isPositive = ['REWARD', 'PVP_WIN', 'REFERRAL_BONUS'].includes(tx.type);

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

    // --- 4. FLUTTERWAVE DEPOSIT WEBHOOK ---
    async handleFlutterwaveWebhook(signature: string, payload: any) {
        const secretHash = this.configService.get<string>('FLUTTERWAVE_WEBHOOK_SECRET');
        if (signature !== secretHash) {
            throw new BadRequestException('Invalid webhook signature');
        }

        if (payload.event === 'charge.completed' && payload.data.status === 'successful') {
            const amountPaid = payload.data.amount;
            const userEmail = payload.data.customer.email;
            const txRef = payload.data.tx_ref;

            const existingTx = await this.prisma.escrowTransaction.findUnique({
                where: { reference: txRef }
            });
            if (existingTx) return { message: 'Transaction already processed' };

            const developer = await this.prisma.user.findUnique({ where: { email: userEmail } });
            if (!developer) throw new NotFoundException('Developer not found for this payment');

            // ATOMIC TRANSACTION: Add money to Escrow and Log it
            await this.prisma.$transaction(async (tx) => {
                // Convert deposited NGN to USD using dynamic rate, or just assume amountPaid is USD
                // *For MVP, assuming Developers are paying in USD on Flutterwave!*
                await tx.user.update({
                    where: { id: developer.id },
                    data: { escrowBalance: { increment: amountPaid } }
                });

                await tx.escrowTransaction.create({
                    data: {
                        developerId: developer.id,
                        amount: amountPaid,
                        type: 'DEPOSIT',
                        status: 'COMPLETED',
                        reference: txRef,
                        metadata: payload.data,
                    }
                });
            });

            return { status: 'success' };
        }
        return { status: 'ignored' };
    }

    // --- 5. ESCROW HISTORY ---
    async getEscrowHistory(developerId: string) {
        return this.prisma.escrowTransaction.findMany({
            where: { developerId },
            orderBy: { createdAt: 'desc' }
        });
    }
}