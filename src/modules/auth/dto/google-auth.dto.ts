import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AccountType } from '@prisma/client';

export class GoogleAuthDto {
    @IsString()
    @IsNotEmpty()
    idToken: string;

    @IsEnum(AccountType)
    @IsOptional()
    accountType?: AccountType;

    @IsString()
    @IsOptional()
    referredByCode?: string;
}