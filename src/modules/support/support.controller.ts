import { Body, Controller, Get, Post } from '@nestjs/common';
import { SupportService } from './support.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ContactFormDto } from './dto/contact-form.dto';

@Controller('support')
export class SupportController {
    constructor(private readonly supportService: SupportService) { }

    @Get('tickets')
    getUserTickets(@CurrentUser('id') userId: string) {
        return this.supportService.getUserTickets(userId);
    }

    @Post('tickets')
    createTicket(@CurrentUser('id') userId: string, @Body() dto: CreateTicketDto) {
        return this.supportService.createTicket(userId, dto);
    }

    @Public()
    @Post('contact')
    submitPublicContactForm(@Body() dto: ContactFormDto) {
        return this.supportService.submitPublicContactForm(dto);
    }
}