import { Body, Controller, Post } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VerifyBankDto } from './dto/verify-bank.dto';

@Controller('verification')
export class VerificationController {
    constructor(private readonly verificationService: VerificationService) { }

    @Post('bank-account')
    verifyBankAccount(
        @CurrentUser('id') userId: string,
        @Body() dto: VerifyBankDto
    ) {
        return this.verificationService.linkAndVerifyBankAccount(userId, dto);
    }
}