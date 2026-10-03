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
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new BadRequestException('User does not exist');

        if (user.kycStatus === KycStatus.VERIFIED) {
            throw new ConflictException('Your account is already verified. Please contact support to change your bank details.');
        }

        if (!user.name) throw new BadRequestException('Your profile is missing a registered name.');

        const existing = await this.prisma.bankAccount.findUnique({
            where: {
                unique_bank_destination: {
                    bankCode: dto.bankCode,
                    accountNumber: dto.accountNumber,
                },
            },
        });

        if (existing && existing.userId !== userId) {
            throw new ConflictException('This bank account is already linked to another Mavuly account.');
        }

        const resolved = await this.flutterwave.resolveBankAccount(dto.accountNumber, dto.bankCode);

        const isValidName = this.validateNameMatch(user.name, resolved.accountName);

        if (!isValidName) {
            throw new BadRequestException(
                `This name doesn't match your registered profile. Please use an account you own that matches your name (${user.name}).`
            );
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
                data: {
                    kycStatus: KycStatus.VERIFIED,
                    legalName: resolved.accountName
                },
            });

            return {
                message: 'Bank account verified and linked successfully!',
                accountName: bankRecord.accountName,
                kycStatus: KycStatus.VERIFIED
            };
        });
    }

    private validateNameMatch(registeredName: string, bankAccountName: string): boolean {
        if (!registeredName || !bankAccountName) return false;

        const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/);

        const regTokens = normalize(registeredName);
        const bankTokens = normalize(bankAccountName);

        let matchCount = 0;
        for (const token of regTokens) {
            if (bankTokens.includes(token)) {
                matchCount++;
            }
        }

        const requiredMatches = Math.min(regTokens.length, 2);

        return matchCount >= requiredMatches;
    }
}