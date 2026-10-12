import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ContactFormDto } from './dto/contact-form.dto';

@Injectable()
export class SupportService {
    constructor(
        private prisma: PrismaService,
        private mailService: MailService
    ) { }

    async createTicket(userId: string, dto: CreateTicketDto) {
        return this.prisma.ticket.create({
            data: {
                userId,
                category: dto.category,
                subject: dto.subject,
                description: dto.description,
                status: 'OPEN'
            }
        });
    }

    async getUserTickets(userId: string) {
        return this.prisma.ticket.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });
    }

    async submitPublicContactForm(dto: ContactFormDto) {
        console.log(`\n📨 NEW MESSAGE FROM: ${dto.email}\nSubject: ${dto.subject}\nMessage: ${dto.message}\n`);
        await this.mailService.sendContactFormNotification(dto.email, dto.subject, dto.message);
        return { message: 'Your message has been sent successfully. We will get back to you shortly!' };
    }

}