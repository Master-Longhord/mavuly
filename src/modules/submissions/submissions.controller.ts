import { Body, Controller, Param, Patch, Post, Get, UnauthorizedException, Headers } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AccountType, Role } from '@prisma/client';
import { StartSubmissionDto } from './dto/start-submission.dto';
import { SubmitTaskDto } from './dto/submit-task.dto';
import { ReviewSubmissionDto } from './dto/review-submission.dto';
import { Public } from '../../common/decorators/public.decorator'; // FIXED IMPORT
import { VerifyPostbackDto } from './dto/verify-postback.dto';

@Controller('submissions')
export class SubmissionsController {
    constructor(private readonly submissionsService: SubmissionsService) { }

    // 1. Tester reserves a spot and gets the tracking URL
    @Roles(AccountType.TESTER)
    @Post('start')
    startTask(@CurrentUser('id') testerId: string, @Body() dto: StartSubmissionDto) {
        return this.submissionsService.startTask(testerId, dto);
    }

    // 2. Tester uploads their screenshot proof
    @Roles(AccountType.TESTER)
    @Post(':id/submit')
    submitTask(
        @CurrentUser('id') testerId: string,
        @Param('id') submissionId: string,
        @Body() dto: SubmitTaskDto
    ) {
        return this.submissionsService.submitTask(testerId, submissionId, dto);
    }

    // 3. Developer Accepts or Rejects the screenshot (Escrow is released here!)
    @Roles(AccountType.DEVELOPER, Role.ADMIN)
    @Patch(':id/review')
    reviewSubmission(
        @CurrentUser('id') developerId: string,
        @Param('id') submissionId: string,
        @Body() dto: ReviewSubmissionDto
    ) {
        return this.submissionsService.reviewSubmission(developerId, submissionId, dto);
    }

    @Roles(AccountType.DEVELOPER)
    @Get('developer')
    getDeveloperSubmissions(@CurrentUser('id') developerId: string) {
        return this.submissionsService.getDeveloperSubmissions(developerId);
    }

    @Public()
    @Post('verify-postback')
    verifyPostback(
        @Headers('x-mavuly-api-key') apiKey: string, // FIXED SYNTAX
        @Body() dto: VerifyPostbackDto
    ) {
        if (!apiKey) {
            throw new UnauthorizedException('Missing x-mavuly-api-key header');
        }
        return this.submissionsService.verifyPostback(apiKey, dto);
    }

    @Roles(AccountType.DEVELOPER)
    @Patch('feedback/:id/bug-status')
    updateBugStatus(
        @CurrentUser('id') developerId: string,
        @Param('id') feedbackId: string,
        @Body('bugStatus') bugStatus: string,
        @Body('bugSeverity') bugSeverity?: string
    ) {
        return this.submissionsService.updateBugStatus(developerId, feedbackId, bugStatus, bugSeverity);
    }
}