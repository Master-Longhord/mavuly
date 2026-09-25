const SYMBOLS = ["💎", "⚡", "👑", "🔥", "🚀", "🎯", "🎲", "🛡️"];

function hashSeed(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return h >>> 0;
}

function mulberry32(seed: number) {
    let a = seed;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(rand: () => number, arr: string[]): string[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function generateBoard(seed: string): string[] {
    const rand = mulberry32(hashSeed(seed || "DEFAULTSEED0000"));
    const pairs = [...SYMBOLS, ...SYMBOLS];
    return shuffle(rand, pairs);
}

export function computeTileMatchServerScore(
    seed: string,
    movesLog: { a: number; b: number }[],
    elapsedSeconds: number
) {
    const board = generateBoard(seed);
    const locked = new Set<number>();
    let pairsMatched = 0;
    let failedAttempts = 0;

    for (const move of Array.isArray(movesLog) ? movesLog : []) {
        if (!move || typeof move.a !== "number" || typeof move.b !== "number") continue;
        const { a, b } = move;
        if (a === b || a < 0 || b < 0 || a >= board.length || b >= board.length) continue;
        if (locked.has(a) || locked.has(b)) continue;

        if (board[a] === board[b]) {
            locked.add(a);
            locked.add(b);
            pairsMatched += 1;
        } else {
            failedAttempts += 1;
        }
    }

    const cleared = pairsMatched >= SYMBOLS.length;
    const clampedElapsed = Math.max(0, Math.min(60, Number(elapsedSeconds) || 0));
    const secondsRemaining = Math.max(0, 60 - clampedElapsed);

    const serverScore = cleared
        ? Math.max(0, 1000 - failedAttempts * 15 + Math.round(secondsRemaining * 10))
        : pairsMatched * 100;

    return { serverScore };
}
