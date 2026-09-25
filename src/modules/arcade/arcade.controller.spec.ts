import { Test, TestingModule } from '@nestjs/testing';
import { ArcadeController } from './arcade.controller';

describe('ArcadeController', () => {
  let controller: ArcadeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArcadeController],
    }).compile();

    controller = module.get<ArcadeController>(ArcadeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
