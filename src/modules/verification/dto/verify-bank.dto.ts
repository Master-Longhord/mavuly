import { IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyBankDto {
    @IsString() @IsNotEmpty() @Length(10, 10, { message: 'Account number must be 10 digits' })
    accountNumber: string;

    @IsString() @IsNotEmpty()
    bankCode: string;

    @IsString() @IsNotEmpty()
    bankName: string;
}