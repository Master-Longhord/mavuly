import { Test, TestingModule } from '@nestjs/testing';
import { MultiplayerGateway } from './multiplayer.gateway';

describe('MultiplayerGateway', () => {
  let gateway: MultiplayerGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MultiplayerGateway],
    }).compile();

    gateway = module.get<MultiplayerGateway>(MultiplayerGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
