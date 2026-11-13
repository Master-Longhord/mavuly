import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket, MessageBody, WsException
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MultiplayerService, ROOM_EXPIRY_MS } from './multiplayer.service';
import { WhotService, CardShape } from './games/whot.service';
import { UnoService, UnoColor } from './games/uno.service';
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
  private botMatchmakingTimers = new Map<string, NodeJS.Timeout>();
  private botTurnTimers = new Map<string, NodeJS.Timeout>();
  private roomExpiryTimers = new Map<string, NodeJS.Timeout>();
  private matchParticipantsCache = new Map<string, any[]>();

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

  private isBotUser(userId?: string | null): boolean {
    return Boolean(userId && userId.startsWith('bot_'));
  }

  private getActiveMemoryMatchIds(): Set<string> {
    const ids = new Set<string>();
    for (const id of this.turnDeadlines.keys()) ids.add(id);
    for (const id of this.matchParticipantsCache.keys()) ids.add(id);
    return ids;
  }

  private getGameStateByType(matchId: string, gameType: GameType): any {
    if (gameType === 'WHOT') return this.whotService.getGameState(matchId);
    if (gameType === 'UNO') return this.unoService.getGameState(matchId);
    if (gameType === 'LUDO') return this.ludoService.getGameState(matchId);
    if (gameType === 'MONOPOLY') return this.monopolyService.getGameState(matchId);
    return null;
  }

  private scheduleRoomExpiry(matchId: string) {
    const existing = this.roomExpiryTimers.get(matchId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.roomExpiryTimers.delete(matchId);
      try {
        const res = await this.multiplayerService.expireRoomAndRefund(matchId);
        if (res.expired) {
          this.server.to(matchId).emit('room_cancelled', {
            matchId,
            reason: 'expired',
            message: res.message,
            serverTime: Date.now()
          });
        }
      } catch { }
    }, ROOM_EXPIRY_MS);

    this.roomExpiryTimers.set(matchId, timer);
  }

  private clearMatchTimers(matchId: string) {
    const mmTimer = this.botMatchmakingTimers.get(matchId);
    if (mmTimer) {
      clearTimeout(mmTimer);
      this.botMatchmakingTimers.delete(matchId);
    }
    const turnTimer = this.botTurnTimers.get(matchId);
    if (turnTimer) {
      clearTimeout(turnTimer);
      this.botTurnTimers.delete(matchId);
    }
    const expTimer = this.roomExpiryTimers.get(matchId);
    if (expTimer) {
      clearTimeout(expTimer);
      this.roomExpiryTimers.delete(matchId);
    }
    this.turnDeadlines.delete(matchId);
    this.matchParticipantsCache.delete(matchId);
  }

  private checkRateLimit(client: Socket): boolean {
    const now = Date.now();
    const record = this.rateLimits.get(client.id);
    if (!record || now > record.resetAt) {
      this.rateLimits.set(client.id, { count: 1, resetAt: now + 1000 });
      return true;
    }
    if (record.count >= 8) {
      client.emit('error', { message: 'Too many actions. Please slow down.', serverTime: Date.now() });
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
      if (this.isBotUser(player.userId)) continue;
      for (const [socketId, uid] of this.connectedUsers.entries()) {
        if (uid === player.userId) {
          this.server.to(socketId).emit('receive_cards', { hand: player.hand, serverTime: Date.now() });
        }
      }
    }
  }

  private handleWsError(client: Socket, e: unknown): never {
    const err = e as any;
    const message = err?.message || 'WebSocket action failed';
    client.emit('error', { message, serverTime: Date.now() });
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
      const match = await this.multiplayerService.getRoomInfo(payload.roomCode, this.getActiveMemoryMatchIds());
      client.emit('room_info_data', { match, serverTime: Date.now() });
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
        client.data.userId,
        payload.gameType,
        payload.stakeAmount,
        payload.maxPlayers,
        this.getActiveMemoryMatchIds(),
        false
      );
      client.join(match.id);
      this.scheduleRoomExpiry(match.id);
      client.emit('room_created', { match, serverTime: Date.now() });
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
      const match = await this.multiplayerService.joinRoom(
        client.data.userId,
        payload.roomCode,
        payload.expectedStake,
        this.getActiveMemoryMatchIds()
      );
      const mmTimer = this.botMatchmakingTimers.get(match.id);
      if (mmTimer) {
        clearTimeout(mmTimer);
        this.botMatchmakingTimers.delete(match.id);
      }
      client.join(match.id);
      this.server.to(match.id).emit('player_joined', { match, serverTime: Date.now() });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('quick_match')
  async handleQuickMatch(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { gameType: GameType, stakeAmount: number, maxPlayers: number, vsBot?: boolean }
  ) {
    if (!this.checkRateLimit(client)) return;
    try {
      const { match, isNew } = await this.multiplayerService.quickMatch(
        client.data.userId,
        payload.gameType,
        payload.stakeAmount,
        payload.maxPlayers,
        payload.vsBot,
        this.getActiveMemoryMatchIds()
      );
      client.join(match.id);

      if (payload.vsBot) {
        client.emit('room_created', { match, serverTime: Date.now() });
        await this.launchMatchAndBroadcast(client.data.userId, match.id);
        return;
      }

      if (isNew) {
        this.scheduleRoomExpiry(match.id);
        client.emit('room_created', { match, serverTime: Date.now() });
        const timer = setTimeout(async () => {
          this.botMatchmakingTimers.delete(match.id);
          try {
            const current = await this.prisma.multiplayerMatch.findUnique({
              where: { id: match.id },
              include: { participants: true }
            });
            if (current && current.status === 'WAITING_OPPONENT' && current.participants.length === 1) {
              await this.launchMatchAndBroadcast(client.data.userId, match.id);
            }
          } catch { }
        }, 8000);
        this.botMatchmakingTimers.set(match.id, timer);
      } else {
        const mmTimer = this.botMatchmakingTimers.get(match.id);
        if (mmTimer) {
          clearTimeout(mmTimer);
          this.botMatchmakingTimers.delete(match.id);
        }
        this.server.to(match.id).emit('player_joined', { match, serverTime: Date.now() });
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('leave_room')
  async handleLeaveRoom(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const playedAgainstBot = (this.matchParticipantsCache.get(payload.matchId) || []).some(p => p.isBot);
      this.clearMatchTimers(payload.matchId);
      const result: any = await this.multiplayerService.leaveLobbyAndRefund(client.data.userId, payload.matchId);
      client.leave(payload.matchId);
      if (result.forfeited) {
        this.server.to(payload.matchId).emit('game_over', {
          winnerId: result.winnerId,
          prize: result.prize,
          reason: 'opponent_forfeited',
          playedAgainstBot,
          serverTime: Date.now()
        });
      } else if (result.cancelled) {
        client.emit('room_cancelled', { matchId: payload.matchId, reason: 'cancelled', message: result.message, serverTime: Date.now() });
        this.server.to(payload.matchId).emit('room_cancelled', { matchId: payload.matchId, reason: 'cancelled', message: result.message, serverTime: Date.now() });
      } else {
        this.server.to(payload.matchId).emit('player_left', { match: result.match, serverTime: Date.now() });
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

      const playedAgainstBot = (this.matchParticipantsCache.get(payload.matchId) || []).some(p => p.isBot);
      this.clearMatchTimers(payload.matchId);
      const result = await this.multiplayerService.settleGame(payload.matchId, client.data.userId);
      this.server.to(payload.matchId).emit('game_over', {
        winnerId: client.data.userId,
        prize: result.winnerPrize,
        reason: 'afk_forfeit',
        playedAgainstBot,
        serverTime: Date.now()
      });
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('reconnect_match')
  async handleReconnect(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      await this.multiplayerService.cleanupExpiredWaitingRooms(this.getActiveMemoryMatchIds());

      const rawMatch = await this.prisma.multiplayerMatch.findUnique({
        where: { id: payload.matchId },
        include: { participants: { include: { user: { select: { name: true } } } } }
      });

      if (!rawMatch || rawMatch.status === 'EXPIRED_REFUNDED' || rawMatch.status === 'SETTLED') {
        client.emit('room_cancelled', {
          matchId: payload.matchId,
          reason: rawMatch?.status === 'SETTLED' ? 'settled' : 'expired',
          message: 'This room is no longer active.',
          serverTime: Date.now()
        });
        return;
      }

      if (rawMatch.status === 'WAITING_OPPONENT') {
        const ageMs = Date.now() - new Date(rawMatch.createdAt).getTime();
        if (ageMs >= ROOM_EXPIRY_MS) {
          const res = await this.multiplayerService.expireRoomAndRefund(payload.matchId);
          client.emit('room_cancelled', {
            matchId: payload.matchId,
            reason: 'expired',
            message: res.message,
            serverTime: Date.now()
          });
          return;
        }
        const formattedMatch = this.multiplayerService.formatMatch(rawMatch);
        client.join(payload.matchId);
        client.emit('room_created', { match: formattedMatch, serverTime: Date.now() });
        client.emit('resync_state', {
          matchId: payload.matchId,
          gameType: rawMatch.gameType,
          status: 'WAITING_OPPONENT',
          match: formattedMatch,
          gameState: null,
          turnDeadline: null,
          serverTime: Date.now()
        });
        return;
      }

      const gameState = this.getGameStateByType(payload.matchId, rawMatch.gameType);

      if (!gameState) {
        this.clearMatchTimers(payload.matchId);
        await this.multiplayerService.expireRoomAndRefund(payload.matchId, true);
        client.emit('room_cancelled', {
          matchId: payload.matchId,
          reason: 'expired',
          message: 'Match session expired and your stake has been refunded.',
          serverTime: Date.now()
        });
        return;
      }

      client.join(payload.matchId);

      const cachedParticipants = this.matchParticipantsCache.get(payload.matchId) || [];
      const botParticipants = cachedParticipants.filter(p => p.isBot);
      const formattedMatch = this.multiplayerService.formatMatch(rawMatch, botParticipants);
      const turnDeadline = this.turnDeadlines.get(payload.matchId) || null;

      client.emit('resync_state', {
        matchId: payload.matchId,
        gameType: rawMatch.gameType,
        status: 'PLAYING',
        match: formattedMatch,
        gameState,
        turnDeadline,
        serverTime: Date.now()
      });

      if (rawMatch.gameType === 'WHOT' || rawMatch.gameType === 'UNO') {
        const player = gameState.players.find((p: any) => p.userId === client.data.userId);
        if (player) client.emit('receive_cards', { hand: player.hand, serverTime: Date.now() });
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  private async launchMatchAndBroadcast(hostUserId: string, matchId: string) {
    const mmTimer = this.botMatchmakingTimers.get(matchId);
    if (mmTimer) {
      clearTimeout(mmTimer);
      this.botMatchmakingTimers.delete(matchId);
    }
    const expTimer = this.roomExpiryTimers.get(matchId);
    if (expTimer) {
      clearTimeout(expTimer);
      this.roomExpiryTimers.delete(matchId);
    }

    const match = await this.multiplayerService.startGame(hostUserId, matchId);
    this.matchParticipantsCache.set(matchId, match.participants);
    const userIds = (match as any).participants.map((p: any) => p.userId);

    if ((match as any).participants.some((p: any) => p.isBot)) {
      this.server.to(matchId).emit('player_joined', { match, serverTime: Date.now() });
    }

    let gameState: any;
    if (match.gameType === 'WHOT') {
      gameState = this.whotService.initializeGame(matchId, userIds);
    } else if (match.gameType === 'UNO') {
      gameState = this.unoService.initializeGame(matchId, userIds);
    } else if (match.gameType === 'LUDO') {
      gameState = this.ludoService.initializeGame(matchId, userIds);
    } else if (match.gameType === 'MONOPOLY') {
      gameState = this.monopolyService.initializeGame(matchId, userIds);
    } else {
      throw new Error('Game logic not implemented for this GameType yet.');
    }

    const turnDeadline = this.setTurnDeadline(matchId);

    if (match.gameType === 'LUDO' || match.gameType === 'MONOPOLY') {
      this.server.to(matchId).emit('game_started', {
        matchId,
        currentTurnUserId: gameState.currentTurnUserId,
        turnDeadline,
        participants: match.participants,
        gameState,
        serverTime: Date.now()
      });
    } else {
      const topCard = gameState.playedCards[gameState.playedCards.length - 1];
      this.server.to(matchId).emit('game_started', {
        matchId,
        currentTurnUserId: gameState.currentTurnUserId,
        turnDeadline,
        topCard,
        activeShape: gameState.activeShape || gameState.activeColor,
        direction: gameState.playDirection ?? 1,
        participants: match.participants,
        playerCardCounts: gameState.players.map((p: any) => ({ userId: p.userId, count: p.hand.length })),
        serverTime: Date.now()
      });

      this.emitHandsToAllPlayers(gameState.players);
    }

    this.scheduleBotTurnIfNeeded(matchId, match.gameType, gameState.currentTurnUserId);
  }

  @SubscribeMessage('start_game')
  async handleStartGame(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { matchId: string }
  ) {
    if (!this.checkRateLimit(client)) return;
    try {
      await this.launchMatchAndBroadcast(client.data.userId, payload.matchId);
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

      await this.executeCardPlayAndBroadcast(payload.matchId, match.gameType, client.data.userId, payload.cardId, payload.requestedShape);
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  private async executeCardPlayAndBroadcast(matchId: string, gameType: GameType, userId: string, cardId: string, requestedShape?: string) {
    let gameResult: any;
    if (gameType === 'WHOT') {
      gameResult = this.whotService.playCard(matchId, userId, cardId, requestedShape as any);
    } else if (gameType === 'UNO') {
      gameResult = this.unoService.playCard(matchId, userId, cardId, requestedShape as any);
    } else {
      throw new Error('Invalid game type for play_card');
    }

    const { game, winnerId } = gameResult;
    this.emitHandsToAllPlayers(game.players);

    if (winnerId) {
      const playedAgainstBot = (this.matchParticipantsCache.get(matchId) || []).some(p => p.isBot);
      this.clearMatchTimers(matchId);
      const result = await this.multiplayerService.settleGame(matchId, winnerId);
      this.server.to(matchId).emit('game_over', {
        winnerId,
        prize: result.winnerPrize,
        isBotWinner: result.isBotWinner,
        playedAgainstBot,
        serverTime: Date.now()
      });
    } else {
      const turnDeadline = this.setTurnDeadline(matchId);
      const topCard = game.playedCards[game.playedCards.length - 1];
      this.server.to(matchId).emit('game_state_update', {
        currentTurnUserId: game.currentTurnUserId,
        turnDeadline,
        topCard,
        activeShape: game.activeShape || game.activeColor,
        direction: game.playDirection ?? 1,
        playerCardCounts: game.players.map((p: any) => ({ userId: p.userId, count: p.hand.length })),
        lastPlay: game.lastPlay,
        serverTime: Date.now()
      });

      this.scheduleBotTurnIfNeeded(matchId, gameType, game.currentTurnUserId);
    }
  }

  @SubscribeMessage('draw_market')
  async handleDrawMarket(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: payload.matchId } });
      if (!match) throw new Error('Match not found');

      await this.executeDrawMarketAndBroadcast(payload.matchId, match.gameType, client.data.userId);
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  private async executeDrawMarketAndBroadcast(matchId: string, gameType: GameType, userId: string) {
    let gameResult: any;
    if (gameType === 'WHOT') {
      gameResult = this.whotService.drawMarket(matchId, userId, 1);
    } else if (gameType === 'UNO') {
      gameResult = this.unoService.drawMarket(matchId, userId, 1);
    } else {
      throw new Error('Invalid game type for draw_market');
    }

    const { game } = gameResult;
    const turnDeadline = this.setTurnDeadline(matchId);

    this.emitHandsToAllPlayers(game.players);

    this.server.to(matchId).emit('game_state_update', {
      currentTurnUserId: game.currentTurnUserId,
      turnDeadline,
      topCard: game.playedCards[game.playedCards.length - 1],
      activeShape: game.activeShape || game.activeColor,
      direction: game.playDirection ?? 1,
      playerCardCounts: game.players.map((p: any) => ({ userId: p.userId, count: p.hand.length })),
      lastPlay: game.lastPlay,
      serverTime: Date.now()
    });

    this.scheduleBotTurnIfNeeded(matchId, gameType, game.currentTurnUserId);
  }

  @SubscribeMessage('roll_dice')
  async handleRollDice(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const match = await this.prisma.multiplayerMatch.findUnique({ where: { id: payload.matchId } });
      if (!match) throw new Error('Match not found');

      const turnDeadline = this.setTurnDeadline(payload.matchId);

      if (match.gameType === 'LUDO') {
        const { game, roll, skipped, movableByDistance } = this.ludoService.rollDice(payload.matchId, client.data.userId);
        this.server.to(payload.matchId).emit('dice_rolled', {
          userId: client.data.userId,
          roll,
          skipped,
          movableByDistance,
          turnDeadline,
          currentTurnUserId: game.currentTurnUserId,
          serverTime: Date.now()
        });

        if (skipped) {
          this.server.to(payload.matchId).emit('ludo_state_update', {
            players: game.players,
            currentTurnUserId: game.currentTurnUserId,
            turnDeadline,
            hasRolled: game.hasRolled,
            lastMove: null,
            serverTime: Date.now()
          });
          this.scheduleBotTurnIfNeeded(payload.matchId, 'LUDO', game.currentTurnUserId);
        }
      } else if (match.gameType === 'MONOPOLY') {
        const { game, winnerId } = this.monopolyService.rollDice(payload.matchId, client.data.userId);
        if (winnerId) {
          const playedAgainstBot = (this.matchParticipantsCache.get(payload.matchId) || []).some(p => p.isBot);
          this.clearMatchTimers(payload.matchId);
          const result = await this.multiplayerService.settleGame(payload.matchId, winnerId);
          this.server.to(payload.matchId).emit('game_over', {
            winnerId,
            prize: result.winnerPrize,
            isBotWinner: result.isBotWinner,
            playedAgainstBot,
            serverTime: Date.now()
          });
        } else {
          this.server.to(payload.matchId).emit('monopoly_state_update', { gameState: game, turnDeadline, serverTime: Date.now() });
          this.scheduleBotTurnIfNeeded(payload.matchId, 'MONOPOLY', game.currentTurnUserId);
        }
      }
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  @SubscribeMessage('move_token')
  async handleMoveToken(@ConnectedSocket() client: Socket, @MessageBody() payload: { matchId: string, tokenId: number, distance: number }) {
    if (!this.checkRateLimit(client)) return;
    try {
      const { game, winnerId, movableByDistance } = this.ludoService.moveToken(payload.matchId, client.data.userId, payload.tokenId, payload.distance);

      if (winnerId) {
        const playedAgainstBot = (this.matchParticipantsCache.get(payload.matchId) || []).some(p => p.isBot);
        this.clearMatchTimers(payload.matchId);
        const result = await this.multiplayerService.settleGame(payload.matchId, winnerId);
        this.server.to(payload.matchId).emit('game_over', {
          winnerId,
          prize: result.winnerPrize,
          lastMove: game.lastMove,
          isBotWinner: result.isBotWinner,
          playedAgainstBot,
          serverTime: Date.now()
        });
      } else {
        const turnDeadline = this.setTurnDeadline(payload.matchId);
        this.server.to(payload.matchId).emit('ludo_state_update', {
          players: game.players,
          currentTurnUserId: game.currentTurnUserId,
          turnDeadline,
          hasRolled: game.hasRolled,
          lastMove: game.lastMove,
          movableByDistance,
          serverTime: Date.now()
        });
        this.scheduleBotTurnIfNeeded(payload.matchId, 'LUDO', game.currentTurnUserId);
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
      this.server.to(payload.matchId).emit('monopoly_state_update', { gameState: game, turnDeadline, serverTime: Date.now() });
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
      this.server.to(payload.matchId).emit('monopoly_state_update', { gameState: game, turnDeadline, serverTime: Date.now() });
      this.scheduleBotTurnIfNeeded(payload.matchId, 'MONOPOLY', game.currentTurnUserId);
    } catch (e) {
      this.handleWsError(client, e);
    }
  }

  private scheduleBotTurnIfNeeded(matchId: string, gameType: GameType, currentTurnUserId: string) {
    if (!this.isBotUser(currentTurnUserId)) return;

    const existing = this.botTurnTimers.get(matchId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.botTurnTimers.delete(matchId);
      try {
        await this.executeBotTurn(matchId, gameType, currentTurnUserId);
      } catch (err) {
        console.error(`Bot turn error in match ${matchId}:`, (err as any)?.message);
      }
    }, 1200);

    this.botTurnTimers.set(matchId, timer);
  }

  private async executeBotTurn(matchId: string, gameType: GameType, botUserId: string) {
    if (gameType === 'WHOT') {
      const state = this.whotService.getGameState(matchId);
      if (!state || state.currentTurnUserId !== botUserId) return;

      const botPlayer = state.players.find(p => p.userId === botUserId);
      if (!botPlayer) return;

      const topCard = state.playedCards[state.playedCards.length - 1]!;
      const playable = botPlayer.hand.find(
        c => c.number === 20 || c.shape === state.activeShape || c.number === topCard.number
      );

      if (playable) {
        let reqShape: CardShape | undefined;
        if (playable.number === 20) {
          const nonWhot = botPlayer.hand.find(c => c.shape !== 'WHOT');
          reqShape = nonWhot ? nonWhot.shape : 'CIRCLE';
        }
        await this.executeCardPlayAndBroadcast(matchId, 'WHOT', botUserId, playable.id, reqShape);
      } else {
        await this.executeDrawMarketAndBroadcast(matchId, 'WHOT', botUserId);
      }
    } else if (gameType === 'UNO') {
      const state = this.unoService.getGameState(matchId);
      if (!state || state.currentTurnUserId !== botUserId) return;

      const botPlayer = state.players.find(p => p.userId === botUserId);
      if (!botPlayer) return;

      const topCard = state.playedCards[state.playedCards.length - 1]!;
      const playable = botPlayer.hand.find(
        c => c.color === 'WILD' || c.color === state.activeColor || c.type === topCard.type
      );

      if (playable) {
        let reqColor: UnoColor | undefined;
        if (playable.color === 'WILD') {
          const colored = botPlayer.hand.find(c => c.color !== 'WILD');
          reqColor = colored ? colored.color : 'RED';
        }
        await this.executeCardPlayAndBroadcast(matchId, 'UNO', botUserId, playable.id, reqColor);
      } else {
        await this.executeDrawMarketAndBroadcast(matchId, 'UNO', botUserId);
      }
    } else if (gameType === 'LUDO') {
      const state = this.ludoService.getGameState(matchId);
      if (!state || state.currentTurnUserId !== botUserId) return;

      const executeMove = async (currentState: any) => {
        let chosenTokenId: number | undefined;
        let chosenDistance: number | undefined;

        if (currentState.movableByDistance) {
          const distances = Object.keys(currentState.movableByDistance).map(Number);
          if (distances.length > 0) {
            chosenDistance = distances[0];
            chosenTokenId = currentState.movableByDistance[chosenDistance]![0];
          }
        }

        if (!chosenTokenId || !chosenDistance) return;

        const { game: afterMove, winnerId, movableByDistance } = this.ludoService.moveToken(matchId, botUserId, chosenTokenId, chosenDistance);
        if (winnerId) {
          const playedAgainstBot = (this.matchParticipantsCache.get(matchId) || []).some(p => p.isBot);
          this.clearMatchTimers(matchId);
          const result = await this.multiplayerService.settleGame(matchId, winnerId);
          this.server.to(matchId).emit('game_over', {
            winnerId, prize: result.winnerPrize, lastMove: afterMove.lastMove, isBotWinner: result.isBotWinner, playedAgainstBot, serverTime: Date.now()
          });
        } else {
          const nextDeadline = this.setTurnDeadline(matchId);
          this.server.to(matchId).emit('ludo_state_update', {
            players: afterMove.players, currentTurnUserId: afterMove.currentTurnUserId,
            turnDeadline: nextDeadline, hasRolled: afterMove.hasRolled, lastMove: afterMove.lastMove,
            movableByDistance, serverTime: Date.now()
          });
          this.scheduleBotTurnIfNeeded(matchId, 'LUDO', afterMove.currentTurnUserId);
        }
      };

      if (state.hasRolled && state.availableMoves.length > 0) {
        const moveTimer = setTimeout(() => executeMove(state), 900);
        this.botTurnTimers.set(matchId, moveTimer);
      } else {
        const { game, roll, skipped, movableByDistance } = this.ludoService.rollDice(matchId, botUserId);
        const turnDeadline = this.setTurnDeadline(matchId);

        this.server.to(matchId).emit('dice_rolled', {
          userId: botUserId, roll, skipped, movableByDistance, turnDeadline, currentTurnUserId: game.currentTurnUserId, serverTime: Date.now()
        });

        if (skipped || Object.keys(movableByDistance).length === 0) {
          this.server.to(matchId).emit('ludo_state_update', {
            players: game.players, currentTurnUserId: game.currentTurnUserId,
            turnDeadline, hasRolled: game.hasRolled, lastMove: null, serverTime: Date.now()
          });
          this.scheduleBotTurnIfNeeded(matchId, 'LUDO', game.currentTurnUserId);
          return;
        }

        const moveTimer = setTimeout(() => executeMove(game), 900);
        this.botTurnTimers.set(matchId, moveTimer);
      }
    } else if (gameType === 'MONOPOLY') {
      const state = this.monopolyService.getGameState(matchId);
      if (!state || state.currentTurnUserId !== botUserId) return;

      const { game, winnerId } = this.monopolyService.rollDice(matchId, botUserId);
      const turnDeadline = this.setTurnDeadline(matchId);

      if (winnerId) {
        const playedAgainstBot = (this.matchParticipantsCache.get(matchId) || []).some(p => p.isBot);
        this.clearMatchTimers(matchId);
        const result = await this.multiplayerService.settleGame(matchId, winnerId);
        this.server.to(matchId).emit('game_over', {
          winnerId,
          prize: result.winnerPrize,
          isBotWinner: result.isBotWinner,
          playedAgainstBot,
          serverTime: Date.now()
        });
        return;
      }

      this.server.to(matchId).emit('monopoly_state_update', { gameState: game, turnDeadline, serverTime: Date.now() });

      const finishTimer = setTimeout(() => {
        try {
          const botPlayer = game.players.find(p => p.userId === botUserId);
          if (botPlayer && !botPlayer.isBankrupt) {
            const space = game.board[botPlayer.position];
            if (space && space.type === 'PROPERTY' && !space.ownerId && botPlayer.cash >= (space.cost || 0) + 100) {
              this.monopolyService.buyProperty(matchId, botUserId);
            }
          }
          const { game: afterEnd } = this.monopolyService.endTurn(matchId, botUserId);
          const nextDeadline = this.setTurnDeadline(matchId);
          this.server.to(matchId).emit('monopoly_state_update', { gameState: afterEnd, turnDeadline: nextDeadline, serverTime: Date.now() });
          this.scheduleBotTurnIfNeeded(matchId, 'MONOPOLY', afterEnd.currentTurnUserId);
        } catch { }
      }, 1000);
      this.botTurnTimers.set(matchId, finishTimer);
    }
  }
}