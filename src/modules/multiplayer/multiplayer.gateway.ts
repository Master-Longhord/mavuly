import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MultiplayerService } from './multiplayer.service';
import { WhotService } from './games/whot.service';
import { UnoService } from './games/uno.service';
import { LudoService } from './games/ludo.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameType } from '@prisma/client';

@WebSocketGateway({ cors: { origin: '*' } })
export class MultiplayerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, string>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private multiplayerService: MultiplayerService,
    private whotService: WhotService,
    private unoService: UnoService,
    private ludoService: LudoService,
    private prisma: PrismaService
  ) { }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token || client.handshake.headers['authorization']?.split(' ')[1];
      if (!token) throw new Error('Missing token');

      const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
      const decoded = this.jwtService.verify(token, { secret });

      client.data.userId = decoded.sub;
      this.connectedUsers.set(client.id, decoded.sub);

      console.log(`🟢 Client connected: ${decoded.email} (Socket: ${client.id})`);
    } catch (e) {
      const error = e as any;
      console.error(`🔴 Connection rejected: ${error.message}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`🔴 Client disconnected: ${client.id}`);
    this.connectedUsers.delete(client.id);
  }

  @SubscribeMessage('create_room')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { gameType: GameType, stakeAmount: number, maxPlayers: number }
  ) {
    try {
      const match = await this.multiplayerService.createPrivateRoom(
        client.data.userId, payload.gameType, payload.stakeAmount, payload.maxPlayers
      );
      client.join(match.id);
      client.emit('room_created', { match });
    } catch (e) {
      const error = e as any;
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomCode: string }
  ) {
    try {
      const match = await this.multiplayerService.joinRoom(client.data.userId, payload.roomCode);
      client.join(match.id);
      this.server.to(match.id).emit('player_joined', { match });
    } catch (e) {
      const error = e as any;
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('start_game')
  async handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchId: string }
  ) {
    try {
      const match = await this.multiplayerService.startGame(client.data.userId, payload.matchId);
      const userIds = (match as any).participants.map((p: any) => p.userId);

      let gameState: any;

      if (match.gameType === 'WHOT') {
        gameState = this.whotService.initializeGame(payload.matchId, userIds);
      } else if (match.gameType === 'UNO') {
        gameState = this.unoService.initializeGame(payload.matchId, userIds);
      } else if (match.gameType === 'LUDO') {
        gameState = this.ludoService.initializeGame(payload.matchId, userIds);
      } else {
        throw new Error('Game logic not implemented for this GameType yet.');
      }

      if (match.gameType === 'LUDO') {
        this.server.to(payload.matchId).emit('game_started', {
          matchId: payload.matchId,
          currentTurnUserId: gameState.currentTurnUserId,
          gameState
        });
      } else {
        const topCard = gameState.playedCards[gameState.playedCards.length - 1];
        this.server.to(payload.matchId).emit('game_started', {
          matchId: payload.matchId,
          currentTurnUserId: gameState.currentTurnUserId,
          topCard,
          activeShape: gameState.activeShape || gameState.activeColor
        });

        for (const player of gameState.players) {
          const playerSocketId = [...this.connectedUsers.entries()]
            .find(([socketId, uid]) => uid === player.userId)?.[0];
          if (playerSocketId) {
            this.server.to(playerSocketId).emit('receive_cards', { hand: player.hand });
          }
        }
      }
    } catch (e) {
      const error = e as any;
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('play_card')
  async handlePlayCard(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string, cardId: string, requestedShape?: string }) {
    try {
      const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: payload.matchId } });
      if (!match) throw new Error('Match not found');

      let gameResult: any;

      if (match.gameType === 'WHOT') {
        gameResult = this.whotService.playCard(payload.matchId, client.data.userId, payload.cardId, payload.requestedShape as any);
      } else if (match.gameType === 'UNO') {
        gameResult = this.unoService.playCard(payload.matchId, client.data.userId, payload.cardId, payload.requestedShape as any);
      }

      const { game, winnerId } = gameResult;

      if (winnerId) {
        const result = await this.multiplayerService.settleGame(payload.matchId, winnerId);
        this.server.to(payload.matchId).emit('game_over', { winnerId, prize: result.winnerPrize });
      } else {
        const topCard = game.playedCards[game.playedCards.length - 1];
        this.server.to(payload.matchId).emit('game_state_update', {
          currentTurnUserId: game.currentTurnUserId,
          topCard,
          activeShape: game.activeShape || game.activeColor,
          playerCardCounts: game.players.map((p: any) => ({ userId: p.userId, count: p.hand.length }))
        });

        const player = game.players.find((p: any) => p.userId === client.data.userId);
        if (player) {
          client.emit('receive_cards', { hand: player.hand });
        }
      }
    } catch (e) {
      const error = e as any;
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('draw_market')
  async handleDrawMarket(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    try {
      const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: payload.matchId } });
      if (!match) throw new Error('Match not found');

      let gameResult: any;

      if (match.gameType === 'WHOT') {
        gameResult = this.whotService.drawMarket(payload.matchId, client.data.userId, 1);
      } else if (match.gameType === 'UNO') {
        gameResult = this.unoService.drawMarket(payload.matchId, client.data.userId, 1);
      }

      const { game } = gameResult;

      this.server.to(payload.matchId).emit('game_state_update', {
        currentTurnUserId: game.currentTurnUserId,
        topCard: game.playedCards[game.playedCards.length - 1],
        activeShape: game.activeShape || game.activeColor,
        playerCardCounts: game.players.map((p: any) => ({ userId: p.userId, count: p.hand.length }))
      });

      const player = game.players.find((p: any) => p.userId === client.data.userId);
      if (player) {
        client.emit('receive_cards', { hand: player.hand });
      }
    } catch (e) {
      const error = e as any;
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('roll_dice')
  async handleRollDice(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    try {
      const { game, roll, skipped } = this.ludoService.rollDice(payload.matchId, client.data.userId);

      this.server.to(payload.matchId).emit('dice_rolled', {
        userId: client.data.userId,
        roll,
        skipped,
        currentTurnUserId: game.currentTurnUserId
      });
    } catch (e) {
      const error = e as any;
      client.emit('error', { message: error.message });
    }
  }

  @SubscribeMessage('move_token')
  async handleMoveToken(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string, tokenId: number }) {
    try {
      const { game, winnerId } = this.ludoService.moveToken(payload.matchId, client.data.userId, payload.tokenId);

      if (winnerId) {
        const result = await this.multiplayerService.settleGame(payload.matchId, winnerId);
        this.server.to(payload.matchId).emit('game_over', { winnerId, prize: result.winnerPrize });
      } else {
        this.server.to(payload.matchId).emit('ludo_state_update', {
          players: game.players,
          currentTurnUserId: game.currentTurnUserId,
          hasRolled: game.hasRolled
        });
      }
    } catch (e) {
      const error = e as any;
      client.emit('error', { message: error.message });
    }
  }
}