import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody, WsException
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MultiplayerService } from './multiplayer.service';
import { WhotService } from './games/whot.service';
import { UnoService } from './games/uno.service';
import { LudoService } from './games/ludo.service';
import { MonopolyService } from './games/monopoly.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GameType } from '@prisma/client';

@WebSocketGateway({ cors: { origin: '*' } })
export class MultiplayerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, string>();
  private turnDeadlines = new Map<string, number>();
  private rateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private multiplayerService: MultiplayerService,
    private whotService: WhotService,
    private unoService: UnoService,
    private ludoService: LudoService,
    private monopolyService: MonopolyService,
    private prisma: PrismaService
  ) { }

  private checkRateLimit(client: Socket): boolean {
    const now = Date.now();
    const record = this.rateLimits.get(client.id);
    if (!record || now > record.resetAt) {
      this.rateLimits.set(client.id, { count: 1, resetAt: now + 1000 });
      return true;
    }
    if (record.count >= 8) {
      client.emit('error', { message: 'Too many actions. Please slow down.' });
      return false;
    }
    record.count++;
    return true;
  }

  private setTurnDeadline(matchId: string): number {
    const deadline = Date.now() + 30000;
    this.turnDeadlines.set(matchId, deadline);
    return deadline;
  }

  private emitHandsToAllPlayers(players: { userId: string; hand: any[] }[]) {
    for (const player of players) {
      for (const [socketId, uid] of this.connectedUsers.entries()) {
        if (uid === player.userId) {
          this.server.to(socketId).emit('receive_cards', { hand: player.hand });
        }
      }
    }
  }

  private handleWsError(client: Socket, e: unknown): never {
    const err = e as any;
    const message = err?.message || 'WebSocket action failed';
    client.emit('error', { message });
    throw new WsException(message);
  }

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
    this.rateLimits.delete(client.id);
  }

  @SubscribeMessage('room_info')
  async handleRoomInfo(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomCode: string }
  ) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.multiplayerService.getRoomInfo(payload.roomCode);
      client.emit('room_info_data', { match });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('create_room')
  async handleCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { gameType: GameType, stakeAmount: number, maxPlayers: number }
  ) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.multiplayerService.createPrivateRoom(
        client.data.userId, payload.gameType, payload.stakeAmount, payload.maxPlayers
      );
      client.join(match.id);
      client.emit('room_created', { match });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomCode: string, expectedStake?: number }
  ) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.multiplayerService.joinRoom(client.data.userId, payload.roomCode, payload.expectedStake);
      client.join(match.id);
      this.server.to(match.id).emit('player_joined', { match });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('quick_match')
  async handleQuickMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { gameType: GameType, stakeAmount: number, maxPlayers: number }
  ) {
    if (!this.checkRateLimit(client)) return;
    try {
      const { match, isNew } = await this.multiplayerService.quickMatch(
        client.data.userId, payload.gameType, payload.stakeAmount, payload.maxPlayers
      );
      client.join(match.id);
      if (isNew) {
        client.emit('room_created', { match });
      } else {
        this.server.to(match.id).emit('player_joined', { match });
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const result: any = await this.multiplayerService.leaveLobbyAndRefund(client.data.userId, payload.matchId);
      client.leave(payload.matchId);
      if (result.forfeited) {
        this.turnDeadlines.delete(payload.matchId);
        this.server.to(payload.matchId).emit('game_over', { winnerId: result.winnerId, prize: result.prize, reason: 'opponent_forfeited' });
      } else if (result.cancelled) {
        this.server.to(payload.matchId).emit('room_cancelled', { message: result.message });
      } else {
        this.server.to(payload.matchId).emit('player_left', { match: result.match });
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('claim_afk_forfeit')
  async handleClaimAfkForfeit(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const deadline = this.turnDeadlines.get(payload.matchId);
      if (!deadline || Date.now() < deadline) {
        throw new Error('Turn timer has not expired yet');
      }

      const match = await this.prisma.multiplayerMatch.findUnique({
        where: { id: payload.matchId },
        include: { participants: true }
      });
      if (!match || match.status !== 'PLAYING') throw new Error('Match is not active');

      this.turnDeadlines.delete(payload.matchId);
      const result = await this.multiplayerService.settleGame(payload.matchId, client.data.userId);
      this.server.to(payload.matchId).emit('game_over', {
        winnerId: client.data.userId,
        prize: result.winnerPrize,
        reason: 'afk_forfeit'
      });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('reconnect_match')
  async handleReconnect(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: payload.matchId } });
      if (!match) throw new Error('Match not found');

      client.join(payload.matchId);

      let gameState: any;
      if (match.gameType === 'WHOT') gameState = this.whotService.getGameState(payload.matchId);
      else if (match.gameType === 'UNO') gameState = this.unoService.getGameState(payload.matchId);
      else if (match.gameType === 'LUDO') gameState = this.ludoService.getGameState(payload.matchId);
      else if (match.gameType === 'MONOPOLY') gameState = this.monopolyService.getGameState(payload.matchId);

      if (!gameState) throw new Error('Active game state not found');

      const turnDeadline = this.turnDeadlines.get(payload.matchId) || null;
      client.emit('resync_state', { matchId: payload.matchId, gameType: match.gameType, gameState, turnDeadline });

      if (match.gameType === 'WHOT' || match.gameType === 'UNO') {
        const player = gameState.players.find((p: any) => p.userId === client.data.userId);
        if (player) client.emit('receive_cards', { hand: player.hand });
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('start_game')
  async handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchId: string }
  ) {
    if (!this.checkRateLimit(client)) return;
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
      } else if (match.gameType === 'MONOPOLY') {
        gameState = this.monopolyService.initializeGame(payload.matchId, userIds);
      } else {
        throw new Error('Game logic not implemented for this GameType yet.');
      }

      const turnDeadline = this.setTurnDeadline(payload.matchId);

      if (match.gameType === 'LUDO' || match.gameType === 'MONOPOLY') {
        this.server.to(payload.matchId).emit('game_started', {
          matchId: payload.matchId,
          currentTurnUserId: gameState.currentTurnUserId,
          turnDeadline,
          gameState
        });
      } else {
        const topCard = gameState.playedCards[gameState.playedCards.length - 1];
        this.server.to(payload.matchId).emit('game_started', {
          matchId: payload.matchId,
          currentTurnUserId: gameState.currentTurnUserId,
          turnDeadline,
          topCard,
          activeShape: gameState.activeShape || gameState.activeColor,
          playerCardCounts: gameState.players.map((p: any) => ({ userId: p.userId, count: p.hand.length }))
        });

        this.emitHandsToAllPlayers(gameState.players);
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('play_card')
  async handlePlayCard(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string, cardId: string, requestedShape?: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: payload.matchId } });
      if (!match) throw new Error('Match not found');

      let gameResult: any;

      if (match.gameType === 'WHOT') {
        gameResult = this.whotService.playCard(payload.matchId, client.data.userId, payload.cardId, payload.requestedShape as any);
      } else if (match.gameType === 'UNO') {
        gameResult = this.unoService.playCard(payload.matchId, client.data.userId, payload.cardId, payload.requestedShape as any);
      } else {
        throw new Error('Invalid game type for play_card');
      }

      const { game, winnerId } = gameResult;

      this.emitHandsToAllPlayers(game.players);

      if (winnerId) {
        this.turnDeadlines.delete(payload.matchId);
        const result = await this.multiplayerService.settleGame(payload.matchId, winnerId);
        this.server.to(payload.matchId).emit('game_over', { winnerId, prize: result.winnerPrize });
      } else {
        const turnDeadline = this.setTurnDeadline(payload.matchId);
        const topCard = game.playedCards[game.playedCards.length - 1];
        this.server.to(payload.matchId).emit('game_state_update', {
          currentTurnUserId: game.currentTurnUserId,
          turnDeadline,
          topCard,
          activeShape: game.activeShape || game.activeColor,
          playerCardCounts: game.players.map((p: any) => ({ userId: p.userId, count: p.hand.length })),
          lastPlay: game.lastPlay
        });
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('draw_market')
  async handleDrawMarket(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: payload.matchId } });
      if (!match) throw new Error('Match not found');

      let gameResult: any;

      if (match.gameType === 'WHOT') {
        gameResult = this.whotService.drawMarket(payload.matchId, client.data.userId, 1);
      } else if (match.gameType === 'UNO') {
        gameResult = this.unoService.drawMarket(payload.matchId, client.data.userId, 1);
      } else {
        throw new Error('Invalid game type for draw_market');
      }

      const { game } = gameResult;
      const turnDeadline = this.setTurnDeadline(payload.matchId);

      this.emitHandsToAllPlayers(game.players);

      this.server.to(payload.matchId).emit('game_state_update', {
        currentTurnUserId: game.currentTurnUserId,
        turnDeadline,
        topCard: game.playedCards[game.playedCards.length - 1],
        activeShape: game.activeShape || game.activeColor,
        playerCardCounts: game.players.map((p: any) => ({ userId: p.userId, count: p.hand.length })),
        lastPlay: game.lastPlay
      });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('roll_dice')
  async handleRollDice(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: payload.matchId } });
      if (!match) throw new Error('Match not found');

      const turnDeadline = this.setTurnDeadline(payload.matchId);

      if (match.gameType === 'LUDO') {
        const { game, roll, skipped, movableTokenIds } = this.ludoService.rollDice(payload.matchId, client.data.userId);
        this.server.to(payload.matchId).emit('dice_rolled', {
          userId: client.data.userId,
          roll,
          skipped,
          movableTokenIds,
          turnDeadline,
          currentTurnUserId: game.currentTurnUserId
        });
      } else if (match.gameType === 'MONOPOLY') {
        const { game, winnerId } = this.monopolyService.rollDice(payload.matchId, client.data.userId);
        if (winnerId) {
          this.turnDeadlines.delete(payload.matchId);
          const result = await this.multiplayerService.settleGame(payload.matchId, winnerId);
          this.server.to(payload.matchId).emit('game_over', { winnerId, prize: result.winnerPrize });
        } else {
          this.server.to(payload.matchId).emit('monopoly_state_update', { gameState: game, turnDeadline });
        }
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('move_token')
  async handleMoveToken(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string, tokenId: number }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const { game, winnerId } = this.ludoService.moveToken(payload.matchId, client.data.userId, payload.tokenId);

      if (winnerId) {
        this.turnDeadlines.delete(payload.matchId);
        const result = await this.multiplayerService.settleGame(payload.matchId, winnerId);
        this.server.to(payload.matchId).emit('game_over', { winnerId, prize: result.winnerPrize });
      } else {
        const turnDeadline = this.setTurnDeadline(payload.matchId);
        this.server.to(payload.matchId).emit('ludo_state_update', {
          players: game.players,
          currentTurnUserId: game.currentTurnUserId,
          turnDeadline,
          hasRolled: game.hasRolled
        });
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('buy_property')
  async handleBuyProperty(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const { game } = this.monopolyService.buyProperty(payload.matchId, client.data.userId);
      const turnDeadline = this.setTurnDeadline(payload.matchId);
      this.server.to(payload.matchId).emit('monopoly_state_update', { gameState: game, turnDeadline });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('end_turn')
  async handleEndTurn(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const { game } = this.monopolyService.endTurn(payload.matchId, client.data.userId);
      const turnDeadline = this.setTurnDeadline(payload.matchId);
      this.server.to(payload.matchId).emit('monopoly_state_update', { gameState: game, turnDeadline });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }
}