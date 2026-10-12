import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private transporter: nodemailer.Transporter;

    constructor(private configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get<string>('SMTP_HOST'),
            port: this.configService.get<number>('SMTP_PORT'),
            secure: this.configService.get<number>('SMTP_PORT') === 465, // true for 465, false for 587
            auth: {
                user: this.configService.get<string>('SMTP_USER'),
                pass: this.configService.get<string>('SMTP_PASS'),
            },
        });
    }

    async sendPasswordResetEmail(toEmail: string, resetLink: string) {
        const fromEmail = this.configService.get<string>('FROM_EMAIL') || 'support@mavuly.com';

        const mailOptions = {
            from: `"Mavuly Support" <${fromEmail}>`,
            to: toEmail,
            subject: 'Reset Your Mavuly Password',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eaeaea; border-radius: 10px;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p style="color: #555; line-height: 1.5;">We received a request to reset your password for your Mavuly account.</p>
          <p style="color: #555; line-height: 1.5;">Click the secure button below to choose a new password. This link is valid for 15 minutes.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset Password</a>
          </div>
          <p style="color: #777; font-size: 12px; line-height: 1.5;">If you did not request this, you can safely ignore this email. Your password will not be changed.</p>
        </div>
      `,
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ BREVO SUCCESS: Email sent to ${toEmail} (Message ID: ${info.messageId})`);
        } catch (error) {
            console.error('❌ BREVO ERROR:', error);
        }
    }

    async sendVerificationEmail(toEmail: string, code: string) {
        const fromEmail = this.configService.get<string>('FROM_EMAIL') || 'updates@mavuly.com';

        const mailOptions = {
            from: `"Mavuly" <${fromEmail}>`,
            to: toEmail,
            subject: 'Verify your Mavuly account',
            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2>Welcome to Mavuly!</h2>
          <p>Your 6-digit verification code is:</p>
          <h1 style="letter-spacing: 5px; color: #10b981;">${code}</h1>
          <p>This code expires in 15 minutes.</p>
        </div>
      `,
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ BREVO SUCCESS: Email sent to ${toEmail} (Message ID: ${info.messageId})`);
        } catch (error) {
            console.error('❌ BREVO ERROR:', error);
        }
    }
}