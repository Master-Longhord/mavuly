import { IsNotEmpty, IsString } from 'class-validator';

export class StartSubmissionDto {
    @IsString() @IsNotEmpty()
    campaignId: string;
}