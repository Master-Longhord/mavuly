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

function generateQuestions(seed: string, count = 60) {
    const rand = mulberry32(hashSeed(seed || "DEFAULTSEED0000"));
    const questions: any[] = [];

    for (let i = 0; i < count; i++) {
        const opType = Math.floor(rand() * 3);
        let a: number, b: number, answer: number;

        if (opType === 0) {
            a = 5 + Math.floor(rand() * 95);
            b = 5 + Math.floor(rand() * 95);
            answer = a + b;
        } else if (opType === 1) {
            a = 5 + Math.floor(rand() * 95);
            b = 5 + Math.floor(rand() * 95);
            if (b > a) [a, b] = [b, a];
            answer = a - b;
        } else {
            a = 1 + Math.floor(rand() * 12);
            b = 1 + Math.floor(rand() * 12);
            answer = a * b;
        }
        questions.push({ answer });
    }
    return questions;
}

export function computeMathServerScore(
    seed: string,
    answersLog: { index: number; selected: number }[]
) {
    const questions = generateQuestions(seed);
    const seen = new Set<number>();
    let score = 0;
    let streak = 0;

    for (const entry of Array.isArray(answersLog) ? answersLog : []) {
        if (!entry || typeof entry.index !== "number" || typeof entry.selected !== "number") continue;
        if (entry.index < 0 || entry.index >= questions.length) continue;
        if (seen.has(entry.index)) continue;
        seen.add(entry.index);

        const q = questions[entry.index];
        if (entry.selected === q.answer) {
            streak += 1;
            score += 10 + 2 * (streak - 1);
        } else {
            streak = 0;
            score -= 5;
        }
    }
    return { serverScore: Math.max(0, score) };
}