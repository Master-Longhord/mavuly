import { IsEmail, IsEnum, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { AccountType } from '@prisma/client';

export class RegisterDto {
    @IsEmail({}, { message: 'Please provide a valid email address' })
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8, { message: 'Password must be at least 8 characters long' })
    password: string;

    @IsString()
    @IsNotEmpty({ message: 'Full name is required for KYC matching' })
    name: string;

    @IsString()
    @IsNotEmpty({ message: 'Phone number is required' })
    phone: string;

    @IsEnum(AccountType, { message: 'Account type must be either TESTER or DEVELOPER' })
    @IsNotEmpty()
    accountType: AccountType;
}