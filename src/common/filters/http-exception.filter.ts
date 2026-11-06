import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
        if (host.getType() === 'ws') {
            const client = host.switchToWs().getClient();
            const data = host.switchToWs().getData();
            let wsMessage = 'WebSocket error';

            if (exception instanceof WsException) {
                const wsErr = exception.getError();
                wsMessage = typeof wsErr === 'string' ? wsErr : (wsErr as any)?.message || wsMessage;
            } else if (exception instanceof HttpException) {
                const res = exception.getResponse() as any;
                wsMessage = typeof res === 'string' ? res : (res.message || res.error || exception.message);
            } else if (exception instanceof Error) {
                wsMessage = exception.message;
            }

            const finalWsMessage = Array.isArray(wsMessage) ? wsMessage[0] : wsMessage;
            client.emit('error', { message: finalWsMessage });
            client.emit('exception', { status: 'error', message: finalWsMessage, cause: data });
            return;
        }

        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();

        let status = HttpStatus.INTERNAL_SERVER_ERROR;
        let message: string | string[] = 'Internal server error';
        let code = 'INTERNAL_ERROR';

        if (exception instanceof HttpException) {
            status = exception.getStatus();
            const res = exception.getResponse() as any;

            message = typeof res === 'string' ? res : (res.message || res.error);
            code = (res.error || 'ERROR').toUpperCase().replace(/\s+/g, '_');
        }

        const finalMessage = Array.isArray(message) ? message[0] : message;

        response.status(status).json({
            success: false,
            code,
            message: finalMessage,
        });
    }
}