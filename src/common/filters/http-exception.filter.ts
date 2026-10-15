import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message: string | string[] = 'Internal server error';
        let code = 'INTERNAL_ERROR';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const res = exception.getResponse() as any;

            message = typeof res === 'string' ? res : (res.message || res.error);
            // Create a machine-readable code (e.g. "Bad Request" -> "BAD_REQUEST")
            code = (res.error || 'ERROR').toUpperCase().replace(/\s+/g, '_');
        }

        // Force message to always be a single string for the frontend
        const finalMessage = Array.isArray(message) ? message[0] : message;

        response.status(status).json({
            success: false,
            code,
            message: finalMessage,
        });
    }
}