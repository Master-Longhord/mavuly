import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum ReviewAction {
    ACCEPT = 'ACCEPT',
    REJECT = 'REJECT'
}

export class ReviewSubmissionDto {
    @IsEnum(ReviewAction) @IsNotEmpty()
    action: ReviewAction;

    @IsString() @IsOptional()
    rejectionReason?: string;
}