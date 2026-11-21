import * as crypto from 'crypto';
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import axios from 'axios';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private mailService: MailService,
    ) { }

    private async generateUniqueReferralCode(seedName: string): Promise<string> {
        const cleaned = (seedName || 'USR').toUpperCase().replace(/[^A-Z]/g, '');
        const baseName = (cleaned + 'USR').substring(0, 3);

        for (let i = 0; i < 5; i++) {
            const candidate = `${baseName}${Math.floor(1000 + Math.random() * 9000)}`;
            const exists = await this.prisma.user.findUnique({ where: { referralCode: candidate } });
            if (!exists) return candidate;
        }

        return `${baseName}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    }

    private async creditReferralRewardsIfEligible(referredUserId: string, referredUserName: string, referredById: string | null) {
        if (!referredById || referredById === referredUserId) return;

        const referrerTxRef = `REF-${referredUserId}`;
        const inviteeTxRef = `REF-WELCOME-${referredUserId}`;

        const existingTx = await this.prisma.transaction.findUnique({ where: { reference: referrerTxRef } });
        if (existingTx) return;

        await this.prisma.$transaction([
            this.prisma.user.update({
                where: { id: referredById },
                data: { coinBalance: { increment: 100 } },
            }),
            this.prisma.transaction.create({
                data: {
                    userId: referredById,
                    amount: 100,
                    type: 'REFERRAL_BONUS',
                    status: 'COMPLETED',
                    reference: referrerTxRef,
                    description: `Referral bonus for inviting ${referredUserName}`,
                },
            }),
            this.prisma.notification.create({
                data: {
                    userId: referredById,
                    message: `🎉 ${referredUserName} joined Mavuly using your referral link! You earned +100 KudiCoins.`,
                },
            }),
            this.prisma.user.update({
                where: { id: referredUserId },
                data: { coinBalance: { increment: 50 } },
            }),
            this.prisma.transaction.create({
                data: {
                    userId: referredUserId,
                    amount: 50,
                    type: 'REFERRAL_BONUS',
                    status: 'COMPLETED',
                    reference: inviteeTxRef,
                    description: 'Referral welcome bonus for joining via an invite link',
                },
            }),
            this.prisma.notification.create({
                data: {
                    userId: referredUserId,
                    message: '🎁 Welcome bonus! You earned +50 KudiCoins for joining Mavuly via a referral link.',
                },
            }),
        ]);
    }

    async register(dto: RegisterDto) {
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (existingUser) {
            throw new ConflictException('Email already in use');
        }

        const hashedPassword = await argon2.hash(dto.password);
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const newReferralCode = await this.generateUniqueReferralCode(dto.name);

        let referredById: string | null = null;
        if (dto.referredByCode) {
            const normalizedCode = dto.referredByCode.trim().toUpperCase();
            const referrer = await this.prisma.user.findUnique({ where: { referralCode: normalizedCode } });
            if (referrer) referredById = referrer.id;
        }

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash: hashedPassword,
                accountType: dto.accountType,
                name: dto.name,
                phone: dto.phone,
                coinBalance: 0,
                emailVerifyToken: verificationCode,
                isEmailVerified: false,
                referralCode: newReferralCode,
                referredById: referredById,
            },
        });

        await this.mailService.sendVerificationEmail(user.email, verificationCode);

        return this.generateTokens(user);
    }

    async login(dto: LoginDto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const passwordMatches = await argon2.verify(user.passwordHash, dto.password);
        if (!passwordMatches) {
            throw new UnauthorizedException('Invalid credentials');
        }

        return this.generateTokens(user);
    }

    async googleLogin(dto: GoogleAuthDto) {
        try {
            const response = await axios.get(`https://oauth2.googleapis.com/tokeninfo?id_token=${dto.idToken}`);
            const { email, name, email_verified } = response.data;

            if (!email || email_verified !== 'true') {
                throw new UnauthorizedException('Google account email is not verified');
            }

            let user = await this.prisma.user.findUnique({ where: { email } });

            if (!user) {
                const randomPassword = await argon2.hash(crypto.randomBytes(32).toString('hex'));
                const newReferralCode = await this.generateUniqueReferralCode(name || email);

                let referredById: string | null = null;
                if (dto.referredByCode) {
                    const normalizedCode = dto.referredByCode.trim().toUpperCase();
                    const referrer = await this.prisma.user.findUnique({ where: { referralCode: normalizedCode } });
                    if (referrer) referredById = referrer.id;
                }

                user = await this.prisma.user.create({
                    data: {
                        email,
                        name: name || email.split('@')[0],
                        passwordHash: randomPassword,
                        accountType: dto.accountType || 'TESTER',
                        coinBalance: 0,
                        isEmailVerified: true,
                        referralCode: newReferralCode,
                        referredById,
                    }
                });

                await this.creditReferralRewardsIfEligible(user.id, user.name || user.email, referredById);
            }

            return this.generateTokens(user);
        } catch (e) {
            throw new UnauthorizedException('Invalid Google token');
        }
    }

    private async generateTokens(user: any) {
        const payload = {
            sub: user.id,
            email: user.email,
            role: user.role,
            accountType: user.accountType,
        };

        const accessToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
            expiresIn: '15m',
        });

        const refreshToken = this.jwtService.sign(payload, {
            secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
            expiresIn: '7d',
        });

        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        await this.prisma.refreshToken.create({
            data: {
                tokenHash,
                userId: user.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            }
        });

        return { accessToken, refreshToken };
    }

    async refreshToken(refreshToken: string) {
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        const storedToken = await this.prisma.refreshToken.findUnique({
            where: { tokenHash },
            include: { user: true }
        });

        if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        await this.prisma.refreshToken.update({
            where: { id: storedToken.id },
            data: { revoked: true }
        });

        return this.generateTokens(storedToken.user);
    }

    async logout(refreshToken: string) {
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        await this.prisma.refreshToken.updateMany({
            where: { tokenHash },
            data: { revoked: true }
        });
        return { message: 'Logged out successfully' };
    }

    async forgotPassword(dto: ForgotPasswordDto) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (!user) {
            return { message: 'If that email exists, a reset link has been sent.' };
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const tokenExpires = new Date(Date.now() + 15 * 60 * 1000);

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                resetToken: hashedToken,
                resetTokenExpires: tokenExpires,
            }
        });

        const resetLink = `https://mavuly.com/reset-password?token=${resetToken}`;

        await this.mailService.sendPasswordResetEmail(user.email, resetLink);

        return { message: 'If that email exists, a reset link has been sent.' };
    }

    async resetPassword(dto: ResetPasswordDto) {
        const hashedToken = crypto.createHash('sha256').update(dto.token).digest('hex');

        const user = await this.prisma.user.findFirst({
            where: {
                resetToken: hashedToken,
                resetTokenExpires: { gt: new Date() }
            }
        });

        if (!user) {
            throw new UnauthorizedException('Token is invalid or has expired');
        }

        const newHashedPassword = await argon2.hash(dto.newPassword);

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash: newHashedPassword,
                resetToken: null,
                resetTokenExpires: null,
            }
        });

        return { message: 'Password has been reset successfully. You can now log in.' };
    }

    async verifyResetToken(token: string) {
        if (!token) throw new BadRequestException('Token is missing');
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const user = await this.prisma.user.findFirst({
            where: {
                resetToken: hashedToken,
                resetTokenExpires: { gt: new Date() },
            },
        });
        if (!user) throw new BadRequestException('Invalid or expired reset link');
        return { valid: true, message: 'Token is valid' };
    }

    async verifyEmail(dto: VerifyEmailDto) {
        const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (!user) throw new BadRequestException('Invalid request');
        if (user.isEmailVerified) return { message: 'Email already verified' };

        if (user.emailVerifyToken !== dto.code) {
            throw new BadRequestException('Invalid verification code');
        }

        await this.prisma.user.update({
            where: { id: user.id },
            data: { isEmailVerified: true, emailVerifyToken: null }
        });

        await this.creditReferralRewardsIfEligible(user.id, user.name || user.email, user.referredById);

        return { message: 'Email verified successfully!' };
    }

    async resendVerificationEmail(email: string) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user) return { message: 'If the email exists, a code was sent.' };
        if (user.isEmailVerified) return { message: 'Email already verified' };

        const newCode = Math.floor(100000 + Math.random() * 900000).toString();

        await this.prisma.user.update({
            where: { id: user.id },
            data: { emailVerifyToken: newCode }
        });

        await this.mailService.sendVerificationEmail(user.email, newCode);
        return { message: 'If the email exists, a code was sent.' };
    }
}