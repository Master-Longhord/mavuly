import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FlutterwaveService } from './flutterwave.service';
import { KycStatus } from '@prisma/client';

@Injectable()
export class VerificationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly flutterwave: FlutterwaveService,
    ) { }

    async linkAndVerifyBankAccount(userId: string, dto: { accountNumber: string; bankCode: string; bankName: string }) {
        const existing = await this.prisma.bankAccount.findUnique({
            where: {
                unique_bank_destination: {
                    bankCode: dto.bankCode,
                    accountNumber: dto.accountNumber,
                },
            },
        });

        if (existing && existing.userId !== userId) {
            throw new ConflictException('This bank account is already linked to another Mavuly account (Multi-Accounting Blocked).');
        }

        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new BadRequestException('User does not exist');

        const resolved = await this.flutterwave.resolveBankAccount(dto.accountNumber, dto.bankCode);

        const isValidName = this.validateNameMatch(resolved.accountName);
        if (!isValidName) {
            throw new BadRequestException('Account name verification failed. Invalid identity returned by bank.');
        }

        return this.prisma.$transaction(async (tx) => {
            const bankRecord = await tx.bankAccount.upsert({
                where: { userId },
                create: {
                    userId,
                    bankCode: dto.bankCode,
                    bankName: dto.bankName,
                    accountNumber: resolved.accountNumber,
                    accountName: resolved.accountName,
                    isVerified: true,
                },
                update: {
                    bankCode: dto.bankCode,
                    bankName: dto.bankName,
                    accountNumber: resolved.accountNumber,
                    accountName: resolved.accountName,
                    isVerified: true,
                },
            });

            await tx.user.update({
                where: { id: userId },
                data: { kycStatus: KycStatus.VERIFIED },
            });

            return {
                message: 'Bank account verified and linked successfully!',
                accountName: bankRecord.accountName,
                kycStatus: KycStatus.VERIFIED
            };
        });
    }

    private validateNameMatch(bankAccountName: string): boolean {
        return Boolean(bankAccountName && bankAccountName.trim().length > 3);
    }
}