import { IsUrl, IsNotEmpty } from 'class-validator';

export class UpdatePostbackDto {
    @IsUrl({}, { message: 'Must be a valid URL' })
    @IsNotEmpty()
    postbackUrl: string;
}