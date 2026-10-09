import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WithdrawDto } from './dto/withdraw.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('ledger')
export class LedgerController {
    constructor(private readonly ledgerService: LedgerService) { }

    @Post('withdraw')
    requestWithdrawal(
        @CurrentUser('id') userId: string,
        @Body() dto: WithdrawDto
    ) {
        return this.ledgerService.requestWithdrawal(userId, dto);
    }

    @Get('transactions')
    getTransactionHistory(@CurrentUser('id') userId: string) {
        return this.ledgerService.getTransactionHistory(userId);
    }

    @Public()
    @Post('webhook/flutterwave')
    handleFlutterwaveWebhook(
        @Headers('verif-hash') signature: string,
        @Body() payload: any
    ) {
        return this.ledgerService.handleFlutterwaveWebhook(signature, payload);
    }
}