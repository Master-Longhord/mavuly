import { Test, TestingModule } from '@nestjs/testing';
import { MultiplayerService } from './multiplayer.service';

describe('MultiplayerService', () => {
  let service: MultiplayerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MultiplayerService],
    }).compile();

    service = module.get<MultiplayerService>(MultiplayerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
