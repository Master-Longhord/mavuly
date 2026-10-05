import { Test, TestingModule } from '@nestjs/testing';
import { ArcadeService } from './arcade.service';

describe('ArcadeService', () => {
  let service: ArcadeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ArcadeService],
    }).compile();

    service = module.get<ArcadeService>(ArcadeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
