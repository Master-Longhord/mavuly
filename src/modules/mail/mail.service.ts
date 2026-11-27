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
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.6;">
                    <h2>Hello ${name},</h2>
                    <p>You have successfully registered for the <strong>Mavuly Hackathon 2026!</strong></p>
                    <p>Your skills deserve an audience. Your creation deserves an opportunity.</p>
                    
                    <div style="background-color: #f3f4f6; padding: 15px; border-left: 4px solid #10b981; margin: 20px 0;">
                        <h3 style="margin-top: 0; color: #10b981;">⚠️ REQUIRED: Join the Official WhatsApp Group</h3>
                        <p>All hackathon announcements, onboarding details, and support will be communicated exclusively through our WhatsApp community.</p>
                        <a href="${whatsappLink}" style="display: inline-block; background-color: #25D366; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">Join WhatsApp Group Now</a>
                    </div>

                    <h3>Key Dates:</h3>
                    <ul>
                        <li><strong>Registration Deadline:</strong> 27 November 2026</li>
                        <li><strong>Hackathon Commencement:</strong> 30 November 2026</li>
                        <li><strong>Hackathon Submission Date:</strong> 6 December 2026</li>
                    </ul>
                    
                    <p>When your project is ready, submit it here by <strong>6 December 2026</strong>:<br/>
                    <a href="https://mavuly.com/hackathon/submit">https://mavuly.com/hackathon/submit</a></p>
                    
                    <p>Build it. Submit it. Get discovered.</p>
                    <p>Best regards,<br/>
                    <strong>The Mavuly Team</strong><br/>
                    <a href="https://mavuly.com">https://mavuly.com</a></p>
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

    async sendHackathonOnboardingEmail(email: string) {
        const fromEmail = this.configService.get<string>('FROM_EMAIL') || 'updates@mavuly.com';

        const mailOptions = {
            from: `"The Mavuly Team" <${fromEmail}>`,
            to: email,
            subject: "You're invited: Mavuly Hackathon Onboarding, Sunday 7PM",
            text: `Hi,\n\nRegistration for the Mavuly Hackathon 2026 is now closed. Thank you for signing up.\n\nYour onboarding session holds this Sunday at 7:00 PM (WAT) on Google Meet.\n\nJoin the meeting: https://meet.google.com/yok-ycbd-qys\nAdd it to your calendar: https://calendar.app.google/SykXfWc1tejjLixP7\n\nWe'll walk through the challenge, your timeline, how you'll be judged, and what a winning solution looks like. Come with your questions.\n\nSee you Sunday.\n\nThe Mavuly Team`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.6;">
                    <p>Hi,</p>
                    <p>Registration for the Mavuly Hackathon 2026 is now closed. Thank you for signing up.</p>
                    <p>Your onboarding session holds this Sunday at 7:00 PM (WAT) on Google Meet.</p>
                    <p>
                        <strong>Join the meeting:</strong> <a href="https://meet.google.com/yok-ycbd-qys">https://meet.google.com/yok-ycbd-qys</a><br/>
                        <strong>Add it to your calendar:</strong> <a href="https://calendar.app.google/SykXfWc1tejjLixP7">https://calendar.app.google/SykXfWc1tejjLixP7</a>
                    </p>
                    <p>We'll walk through the challenge, your timeline, how you'll be judged, and what a winning solution looks like. Come with your questions.</p>
                    <p>See you Sunday.</p>
                    <p>The Mavuly Team</p>
                </div>
            `,
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            console.log(`✅ BREVO SUCCESS: Hackathon onboarding email sent to ${email} (Message ID: ${info.messageId})`);
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
                <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.6;">
                    <h2>Congratulations ${name},</h2>
                    <p>We have officially received your final project submission: <strong>${projectName}</strong>!</p>
                    <p>Our team will review your application. Get ready to showcase your creation and attract real users.</p>
                    <p><strong>Key Hackathon Dates:</strong></p>
                    <ul>
                        <li><strong>Hackathon Commencement:</strong> 30 November 2026</li>
                        <li><strong>Hackathon Submission Date:</strong> 6 December 2026</li>
                    </ul>
                    <p>Keep an eye on the WhatsApp group for updates and next steps.</p>
                    <p>Best regards,<br/>
                    <strong>The Mavuly Team</strong><br/>
                    <a href="https://mavuly.com">https://mavuly.com</a></p>
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