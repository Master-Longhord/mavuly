import { IsString, IsNotEmpty, IsUrl, IsNumber, Min, IsArray, IsObject, IsOptional, IsDateString } from 'class-validator';

export class CreateCampaignDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsString()
    @IsNotEmpty()
    appName: string;

    @IsUrl()
    @IsNotEmpty()
    targetUrl: string;

    @IsString()
    @IsNotEmpty()
    category: string;

    @IsArray()
    @IsString({ each: true })
    instructions: string[];

    // This will store things like { "os": "Android", "country": "NG" }
    @IsObject()
    @IsOptional()
    requirements?: Record<string, any>;

    @IsNumber()
    @Min(1)
    estimatedMinutes: number;

    @IsString()
    difficulty: string;

    @IsNumber()
    @Min(1)
    targetTesters: number;

    @IsNumber()
    @Min(1) // Minimum reward per tester in real money (e.g., $1.00 or ₦1000)
    rewardPerTask: number;

    // --- NEW FIELDS FOR FRONTEND ---
    @IsString()
    @IsOptional()
    productType?: string; // App, Website, Game

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    platforms?: string[]; // ["Android", "iOS"]

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    version?: string;

    @IsDateString()
    @IsOptional()
    deadline?: string;
}