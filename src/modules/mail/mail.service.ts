import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class MailService {
    private transporter: nodemailer.Transporter;

    constructor(private configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get<string>('SMTP_HOST'),
            port: this.configService.get<number>('SMTP_PORT'),
            secure: this.configService.get<number>('SMTP_PORT') === 465,
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

    async sendContactFormNotification(userEmail: string, subject: string, message: string) {
        const supportEmail = this.configService.get<string>('FROM_EMAIL') || 'support@mavuly.com';

        const mailOptions = {
            from: `"Mavuly Contact Form" <${supportEmail}>`,
            to: supportEmail,
            replyTo: userEmail,
            subject: `[Contact Request] ${subject}`,
            html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h3>New Message from Mavuly Contact Form</h3>
          <p><strong>From:</strong> ${userEmail}</p>
          <p><strong>Subject:</strong> ${subject}</p>
          <hr />
          <p style="white-space: pre-wrap;">${message}</p>
        </div>
      `,
        };

        try {
            await this.transporter.sendMail(mailOptions);
        } catch (error) {
            console.error('Failed to send contact form email to Admin:', error);
        }
    }

    async sendHackathonWelcomeEmail(email: string, name: string, whatsappLink: string) {
        const fromEmail = this.configService.get<string>('FROM_EMAIL') || 'updates@mavuly.com';
        const pdfPath = path.join(process.cwd(), 'mavuly.pdf');
        const attachments = fs.existsSync(pdfPath)
            ? [{ filename: 'Mavuly-Hackathon-Guide.pdf', path: pdfPath, contentType: 'application/pdf' }]
            : [];

        const mailOptions = {
            from: `"Mavuly Hackathon" <${fromEmail}>`,
            to: email,
            subject: 'Welcome to the MAVULY HACKATHON 2026! 🎮',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                    <h2>Hello ${name},</h2>
                    <p>You have successfully registered for the <strong>Mavuly Hackathon 2026!</strong></p>
                    <p>Your skills deserve an audience. Your creation deserves an opportunity.</p>
                    
                    <div style="background-color: #f3f4f6; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0;">
                        <h3 style="margin-top: 0; color: #10b981;">⚠️ REQUIRED: Join the Official WhatsApp Group</h3>
                        <p>All hackathon announcements, onboarding details, and support will be communicated exclusively through our WhatsApp community.</p>
                        <a href="${whatsappLink}" style="display: inline-block; background-color: #25D366; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">Join WhatsApp Group Now</a>
                    </div>

                    <h3>Key Dates (All Times WAT):</h3>
                    <ul>
                        <li><strong>Registration closes:</strong> Fri, 20 November 2026 (11:59 PM WAT)</li>
                        <li><strong>Onboarding session:</strong> Sun, 22 November 2026 — Everything you need to know before you start building</li>
                        <li><strong>Hackathon starts:</strong> Mon, 23 November 2026 — Building window opens</li>
                        <li><strong>Submissions close:</strong> Sun, 29 November 2026 (11:59 PM WAT) — Repo, demo video &amp; pitch deck must be ready</li>
                        <li><strong>Winners announced:</strong> Mon, 30 November 2026 — Top 3 entries share the ₦500,000 prize pool</li>
                    </ul>
                    
                    <p>When your project is ready, submit it here before <strong>November 29, 2026 (11:59 PM WAT)</strong>:<br/>
                    <a href="https://mavuly.com/hackathon/submit">https://mavuly.com/hackathon/submit</a></p>
                    
                    <p>Build it. Submit it. Get discovered.</p>
                    <p>- The Mavuly Team</p>
                </div>
            `,
            attachments,
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ BREVO SUCCESS: Hackathon welcome email sent to ${email} (Message ID: ${info.messageId})`);
        } catch (error) {
            console.error('❌ BREVO ERROR:', error);
        }
    }

    async sendHackathonScheduleUpdateEmail(email: string, name: string, whatsappLink: string) {
        const fromEmail = this.configService.get<string>('FROM_EMAIL') || 'updates@mavuly.com';
        const pdfPath = path.join(process.cwd(), 'mavuly.pdf');
        const attachments = fs.existsSync(pdfPath)
            ? [{ filename: 'Mavuly-Hackathon-Guide.pdf', path: pdfPath, contentType: 'application/pdf' }]
            : [];

        const mailOptions = {
            from: `"Mavuly Hackathon" <${fromEmail}>`,
            to: email,
            subject: '📢 Important Update: Mavuly Hackathon 2026 Timeline & WhatsApp Community',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                    <h2>Hello ${name},</h2>
                    <p>Thank you for registering for the <strong>Mavuly Hackathon 2026!</strong> We are writing to share an important clarification on the official Hackathon schedule and to make sure you have joined the participant WhatsApp group.</p>
                    
                    <div style="background-color: #ecfdf5; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0;">
                        <h3 style="margin-top: 0; color: #065f46;">📌 Schedule Clarification (All Times WAT)</h3>
                        <p style="margin-bottom: 8px;">Please note that <strong>November 20</strong> is only the deadline for <strong>Registration</strong>. You have until <strong>November 29 (11:59 PM WAT)</strong> to submit your final project!</p>
                        <ul style="margin-bottom: 0;">
                            <li><strong>Registration closes:</strong> Nov 20, 2026 (11:59 PM WAT)</li>
                            <li><strong>Onboarding session:</strong> Nov 22, 2026</li>
                            <li><strong>Hackathon building starts:</strong> Nov 23, 2026</li>
                            <li><strong>Final Submissions close:</strong> Nov 29, 2026 (11:59 PM WAT)</li>
                            <li><strong>Winners announced:</strong> Nov 30, 2026 (₦500,000 Prize Pool)</li>
                        </ul>
                    </div>

                    <div style="background-color: #f3f4f6; padding: 15px; border-left: 4px solid #25D366; margin: 20px 0;">
                        <h3 style="margin-top: 0; color: #111827;">💬 Join the Official WhatsApp Group</h3>
                        <p>If you haven't joined yet, click below to join the official participant group for onboarding links, live support, and updates:</p>
                        <a href="${whatsappLink}" style="display: inline-block; background-color: #25D366; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">Join WhatsApp Community</a>
                    </div>

                    <p>We have also attached the official <strong>Mavuly Hackathon Guide PDF</strong> to this email for your reference. When your project, demo video, or pitch deck (PDF/DOC/DOCX) is ready, submit it at:<br/>
                    <a href="https://mavuly.com/hackathon/submit">https://mavuly.com/hackathon/submit</a></p>
                    
                    <p>Build it. Submit it. Get discovered.</p>
                    <p>- The Mavuly Team</p>
                </div>
            `,
            attachments,
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ BREVO SUCCESS: Hackathon schedule update email sent to ${email} (Message ID: ${info.messageId})`);
        } catch (error) {
            console.error('❌ BREVO ERROR:', error);
        }
    }

    async sendHackathonSubmissionEmail(email: string, name: string, projectName: string) {
        const fromEmail = this.configService.get<string>('FROM_EMAIL') || 'updates@mavuly.com';

        const mailOptions = {
            from: `"Mavuly Hackathon" <${fromEmail}>`,
            to: email,
            subject: `Submission Received: ${projectName} 🚀`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto;">
                    <h2>Congratulations ${name},</h2>
                    <p>We have officially received your final project submission: <strong>${projectName}</strong>!</p>
                    <p>Our team will review your application. Get ready to showcase your creation and attract real users.</p>
                    <p><strong>Key Upcoming Dates (WAT):</strong></p>
                    <ul>
                        <li><strong>Submissions close:</strong> November 29, 2026 (11:59 PM WAT)</li>
                        <li><strong>Winners announced:</strong> November 30, 2026 (Top 3 entries share the ₦500,000 prize pool)</li>
                    </ul>
                    <p>Keep an eye on the WhatsApp group for updates and next steps.</p>
                    <p>- The Mavuly Team</p>
                </div>
            `,
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ BREVO SUCCESS: Hackathon submission email sent to ${email} (Message ID: ${info.messageId})`);
        } catch (error) {
            console.error('❌ BREVO ERROR:', error);
        }
    }
}