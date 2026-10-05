import { Body, Controller, Get, Post } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WithdrawDto } from './dto/withdraw.dto';

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
}