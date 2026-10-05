function hashSeed(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
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

const VOWEL_POOL = "EEEEEAAAIIOOUU";
const COMMON_CONSONANT_POOL = "TTNNSSRRHHLLDDCCMM";
const FILLER_POOL = "BFGPWYVKJQXZ";

function weightedPick(rand: () => number, pool: string): string {
    return pool[Math.floor(rand() * pool.length)];
}

function shuffle(rand: () => number, arr: string[]): string[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

export function generateBoardFromSeed(seed: string): string[] {
    const rand = mulberry32(hashSeed(seed || "DEFAULTSEED0000"));
    const letters: string[] = [];
    for (let i = 0; i < 6; i++) letters.push(weightedPick(rand, VOWEL_POOL));
    for (let i = 0; i < 7; i++) letters.push(weightedPick(rand, COMMON_CONSONANT_POOL));
    for (let i = 0; i < 3; i++) letters.push(weightedPick(rand, FILLER_POOL));
    return shuffle(rand, letters);
}

const HIGH_RARITY_LETTERS = ["Q", "Z", "X", "J", "K"];
const MED_RARITY_LETTERS = ["F", "H", "V", "W", "Y"];

export function scoreForWord(word: string): number {
    const len = word.length;
    let base: number;
    if (len === 3) base = 100;
    else if (len === 4) base = 250;
    else if (len === 5) base = 600;
    else if (len === 6) base = 1200;
    else base = 2500;

    let rarityBonus = 0;
    for (const letter of word.toUpperCase()) {
        if (HIGH_RARITY_LETTERS.includes(letter)) rarityBonus += 100;
        else if (MED_RARITY_LETTERS.includes(letter)) rarityBonus += 50;
        else rarityBonus += 10;
    }
    return base + rarityBonus;
}

function letterFrequencyMap(letters: string[]): Record<string, number> {
    const freq: Record<string, number> = {};
    for (const l of letters) freq[l] = (freq[l] || 0) + 1;
    return freq;
}

function isConstructibleFromBoard(word: string, boardFreq: Record<string, number>): boolean {
    const need: Record<string, number> = {};
    for (const letter of word.toUpperCase()) need[letter] = (need[letter] || 0) + 1;
    for (const letter in need) {
        if ((boardFreq[letter] || 0) < need[letter]) return false;
    }
    return true;
}

export function computeWordClashServerScore(boardSeed: string, wordsFound: string[]) {
    const board = generateBoardFromSeed(boardSeed);
    const boardFreq = letterFrequencyMap(board);

    const seen = new Set<string>();
    let serverScore = 0;

    for (const raw of Array.isArray(wordsFound) ? wordsFound : []) {
        if (typeof raw !== "string") continue;
        const word = raw.toUpperCase();
        if (word.length < 3) continue;
        if (seen.has(word)) continue;
        if (!isConstructibleFromBoard(word, boardFreq)) continue;

        seen.add(word);
        serverScore += scoreForWord(word);
    }

    return { serverScore };
}