import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';
import { FlutterwaveService } from './flutterwave.service';

@Module({
  controllers: [VerificationController],
  providers: [VerificationService, FlutterwaveService],
  exports: [VerificationService],
})
export class VerificationModule { }