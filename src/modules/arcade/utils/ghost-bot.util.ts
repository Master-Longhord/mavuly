import { GameType } from '@prisma/client';

const BOT_NAMES = [
    "Alex_99", "Sofia_G", "LiamPlays", "NovaStrike", "Kenji_X",
    "Maya_Pro", "Lucas_V", "Zara_GG", "EthanFast", "Chloe_K",
    "Mateo_7", "Aiden_R", "PixelQueen", "ShadowFox", "Kaito_92",
    "Elena_S", "Marcus_T", "Sammy_Pro", "Leo_Rush", "TundeX",
    "Aria_Codes", "Noah_V", "NinaPlays", "felix_gg", " Tariq_X"
];

export function pickBotName() {
    return BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!.trim();
}

export function generateBoardSeed() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let seed = '';
    for (let i = 0; i < 16; i++) {
        seed += chars[Math.floor(Math.random() * chars.length)];
    }
    return seed;
}

export function generateBotScore(gameType: GameType, humanScore: number): number {
    if (gameType === GameType.TRIVIA_RUSH) return generateTriviaBotScore(humanScore);
    if (gameType === GameType.TILE_MATCH) return generateTileMatchBotScore(humanScore);

    if (gameType === GameType.SNOOKER) {
        const roll = Math.random();
        let botScore = 0;
        if (roll < 0.55) botScore = humanScore * (0.75 + Math.random() * 0.15);
        else if (roll < 0.95) botScore = humanScore + (Math.random() * 15 + 5);
        else botScore = humanScore;

        return Math.max(10, Math.min(147, Math.round(botScore)));
    }

    let botScore: number;
    if (humanScore < 900) {
        botScore = 950 + Math.random() * 300;
    } else {
        const roll = Math.random();
        if (roll < 0.55) botScore = humanScore * (0.80 + Math.random() * 0.13);
        else if (roll < 0.95) botScore = humanScore * (1.06 + Math.random() * 0.14);
        else botScore = humanScore + (Math.random() * 80 - 40);
    }
    return Math.max(900, Math.min(6500, Math.round(botScore)));
}

function generateTriviaBotScore(playerScore: number): number {
    let botScore: number;
    if (playerScore < 150) {
        botScore = 380 + Math.random() * 150;
    } else {
        const roll = Math.random();
        if (roll < 0.55) botScore = playerScore * (0.8 + Math.random() * 0.13);
        else if (roll < 0.95) botScore = playerScore * (1.06 + Math.random() * 14);
        else botScore = playerScore + (Math.random() * 80 - 40);
    }
    return Math.max(350, Math.min(650, Math.round(botScore)));
}

function generateTileMatchBotScore(userScore: number): number {
    const roll = Math.random();
    if (roll < 0.25) return Math.floor(Math.random() * (960 - 820 + 1)) + 820;
    if (roll > 0.80) return Math.floor(Math.random() * (1290 - 1180 + 1)) + 1180;
    return Math.floor(Math.random() * (1160 - 980 + 1)) + 980;
}