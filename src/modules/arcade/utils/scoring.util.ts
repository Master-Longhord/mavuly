import { GameType } from '@prisma/client';
import { computeMathServerScore } from '../games/math-duel.util';
import { computeTileMatchServerScore } from '../games/tile-match.util';
import { computeTriviaServerScore } from '../games/trivia-rush.util';
import { computeWordClashServerScore } from '../games/word-clash.util';

export function computeServerScore(
    gameType: GameType,
    boardSeed: string,
    clientReportedScore: number,
    payload: any,
): { serverScore: number; isTampered: boolean } {

    let serverScore = 0;

    switch (gameType) {
        case GameType.MATH_DUEL:
            serverScore = computeMathServerScore(boardSeed, payload?.answersLog).serverScore;
            break;
        case GameType.TILE_MATCH:
            serverScore = computeTileMatchServerScore(boardSeed, payload?.movesLog, payload?.elapsedSeconds).serverScore;
            break;
        case GameType.TRIVIA_RUSH:
            serverScore = computeTriviaServerScore(boardSeed, payload?.answersLog).serverScore;
            break;
        case GameType.WORD_CLASH:
            serverScore = computeWordClashServerScore(boardSeed, payload?.wordsFound).serverScore;
            break;
        default:
            serverScore = clientReportedScore;
    }

    // Base44 Anti-Cheat: The client cannot claim a score more than 10 points higher than the server verified.
    const isTampered = clientReportedScore > serverScore + 10;

    return { serverScore, isTampered };
}