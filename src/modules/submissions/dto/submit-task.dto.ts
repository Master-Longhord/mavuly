import { IsNotEmpty, IsString, IsOptional, IsObject } from 'class-validator';

export class SubmitTaskDto {
    @IsString() @IsNotEmpty()
    screenshotUrl: string;

    @IsObject() @IsOptional()
    deviceInfo?: Record<string, any>;

    @IsString() @IsOptional()
    comments?: string;
}