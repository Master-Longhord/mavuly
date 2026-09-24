import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
    @IsOptional() @IsString() name?: string;
    @IsOptional() @IsString() studioName?: string;
    @IsOptional() @IsString() phone?: string;
    @IsOptional() @IsString() country?: string;
    @IsOptional() @IsDateString() dob?: string;
    @IsOptional() @IsBoolean() notifications?: boolean;

}