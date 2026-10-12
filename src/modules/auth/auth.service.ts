import * as crypto from 'crypto';
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';

import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

@Injectable()
export class AuthService {
    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private configService: ConfigService,
        private mailService: MailService,
    ) { }

    // --- REGISTRATION & LOGIN ---

    async register(dto: RegisterDto) {
        const existingUser = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (existingUser) {
            throw new ConflictException('Email already in use');
        }

        const hashedPassword = await argon2.hash(dto.password);
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit code

        console.log(`\n 🚀 DEV MODE - VERIFICATION CODE FOR ${dto.email}: ${verificationCode}\n`);

        const baseName = dto.name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'USR');
        const newReferralCode = `${baseName}${Math.floor(1000 + Math.random() * 9000)}`;

        let referredById = null;
        if (dto.referredByCode) {
            const referrer = await this.prisma.user.findUnique({ where: { referralCode: dto.referredByCode } });
            if (referrer) referredById = referrer.id;
        }

        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash: hashedPassword,
                accountType: dto.accountType,
                name: dto.name,
                phone: dto.phone,
                emailVerifyToken: verificationCode,
                isEmailVerified: false,
                referralCode: newReferralCode,
                referredById: referredById,
            },
        });

        if (referredById) {
            await this.prisma.user.update({
                where: { id: referredById },
                data: { coinBalance: { increment: 100 } }
            });
            await this.prisma.transaction.create({
                data: {
                    userId: referredById,
                    amount: 100,
                    type: 'REFERRAL_BONUS',
                    status: 'COMPLETED',
                    reference: `REF-${user.id}`,
                    description: `Referral bonus for inviting ${user.name}`
                }
            });
        }

        // Send the 6-digit verification code to their email!
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

    // --- TOKEN MANAGEMENT (JWT & REFRESH) ---

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

        // Hash and store the refresh token in the database
        const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
        await this.prisma.refreshToken.create({
            data: {
                tokenHash,
                userId: user.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
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

        // Revoke the old token so it can't be used again
        await this.prisma.refreshToken.update({
            where: { id: storedToken.id },
            data: { revoked: true }
        });

        // Issue a fresh pair
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

    // --- PASSWORD RESET FLOW ---

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

    // --- EMAIL VERIFICATION FLOW ---

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