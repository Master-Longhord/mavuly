import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface ResolveAccountResponse {
    status: string;
    message: string;
    data: {
        account_number: string;
        account_name: string;
    };
}

@Injectable()
export class FlutterwaveService {
    private readonly baseUrl = 'https://api.flutterwave.com/v3';

    constructor(private configService: ConfigService) { }

    async resolveBankAccount(accountNumber: string, bankCode: string): Promise<{ accountNumber: string; accountName: string }> {
        const secretKey = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');

        try {
            const response = await axios.post<ResolveAccountResponse>(
                `${this.baseUrl}/accounts/resolve`,
                {
                    account_number: accountNumber,
                    account_bank: bankCode,
                },
                {
                    headers: {
                        Authorization: `Bearer ${secretKey}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 10000,
                }
            );

            if (response.data.status !== 'success' || !response.data.data) {
                throw new BadRequestException('Could not resolve bank account details');
            }

            return {
                accountNumber: response.data.data.account_number,
                accountName: response.data.data.account_name,
            };
        } catch (error: any) {
            if (error.response?.data?.message) {
                throw new BadRequestException(`Flutterwave Error: ${error.response.data.message}`);
            }
            throw new InternalServerErrorException('External payment rail error during verification');
        }
    }
}