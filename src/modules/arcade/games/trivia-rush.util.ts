const TRIVIA_BANK = [
    { id: 1, correctAnswer: "Argentina" },
    { id: 2, correctAnswer: "Nairobi" },
    { id: 3, correctAnswer: "11" },
    { id: 4, correctAnswer: "Robert Downey Jr." },
    { id: 5, correctAnswer: "Au" },
    { id: 6, correctAnswer: "Nile" },
    { id: 7, correctAnswer: "Brazil" },
    { id: 8, correctAnswer: "Mars" },
    { id: 9, correctAnswer: "Michael Jackson" },
    { id: 10, correctAnswer: "Asia" },
    { id: 11, correctAnswer: "2" },
    { id: 12, correctAnswer: "Carbon Dioxide" },
    { id: 13, correctAnswer: "Netflix" },
    { id: 14, correctAnswer: "South Africa" },
    { id: 15, correctAnswer: "Tennis" },
    { id: 16, correctAnswer: "Mitochondria" },
    { id: 17, correctAnswer: "Steven Spielberg" },
    { id: 18, correctAnswer: "Tanzania" },
    { id: 19, correctAnswer: "5" },
    { id: 20, correctAnswer: "100°C" },
    { id: 21, correctAnswer: "Batman" },
    { id: 22, correctAnswer: "Vatican City" },
    { id: 23, correctAnswer: "England" },
    { id: 24, correctAnswer: "H2O" },
    { id: 25, correctAnswer: "Queen" },
    { id: 26, correctAnswer: "Sahara" },
    { id: 27, correctAnswer: "Basketball" },
    { id: 28, correctAnswer: "206" },
    { id: 29, correctAnswer: "J.K. Rowling" },
    { id: 30, correctAnswer: "Australia" },
    { id: 31, correctAnswer: "Uruguay" },
    { id: 32, correctAnswer: "The Sun" },
    { id: 33, correctAnswer: "TikTok" },
    { id: 34, correctAnswer: "Abuja" },
    { id: 35, correctAnswer: "Real Madrid" },
    { id: 36, correctAnswer: "Heart" },
    { id: 37, correctAnswer: "Titanic" },
    { id: 38, correctAnswer: "Pacific" },
    { id: 39, correctAnswer: "3" },
    { id: 40, correctAnswer: "Gravity" },
    { id: 41, correctAnswer: "Michael Jackson" },
    { id: 42, correctAnswer: "India" },
    { id: 43, correctAnswer: "Birdie" },
    { id: 44, correctAnswer: "Diamond" },
    { id: 45, correctAnswer: "Netflix" },
    { id: 46, correctAnswer: "Andes" },
    { id: 47, correctAnswer: "England" },
    { id: 48, correctAnswer: "Omnivore" },
    { id: 49, correctAnswer: "Keanu Reeves" },
    { id: 50, correctAnswer: "Ethiopia" },
    { id: 51, correctAnswer: "18" },
    { id: 52, correctAnswer: "Biology" },
    { id: 53, correctAnswer: "Nintendo's Mario series" },
    { id: 54, correctAnswer: "Strait of Gibraltar" },
    { id: 55, correctAnswer: "Italy" },
    { id: 56, correctAnswer: "Nitrogen" },
    { id: 57, correctAnswer: "Ed Sheeran" },
    { id: 58, correctAnswer: "France" },
    { id: 59, correctAnswer: "LeBron James" },
    { id: 60, correctAnswer: "Leaf" },
    { id: 61, correctAnswer: "Hogwarts" },
    { id: 62, correctAnswer: "China" }
];

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

function pickQuestions(seed: string, count = 5) {
    const rand = mulberry32(hashSeed(seed || "DEFAULTSEED0000"));
    const pool = [...TRIVIA_BANK];
    const picked: any[] = [];
    for (let i = 0; i < count && pool.length; i++) {
        const idx = Math.floor(rand() * pool.length);
        picked.push(pool[idx]);
        pool.splice(idx, 1);
    }
    return picked;
}

export function computeTriviaServerScore(
    seed: string,
    answersLog: { index: number; selected: string; remaining: number }[]
) {
    const questions = pickQuestions(seed, 5);
    const seen = new Set<number>();
    let score = 0;

    for (const entry of Array.isArray(answersLog) ? answersLog : []) {
        if (!entry || typeof entry.index !== "number") continue;
        if (entry.index < 0 || entry.index >= questions.length) continue;
        if (seen.has(entry.index)) continue;
        seen.add(entry.index);

        const q = questions[entry.index];
        const remaining = Math.max(0, Math.min(10, Number(entry.remaining) || 0));
        if (entry.selected === q.correctAnswer) {
            score += 100 + remaining * 5;
        }
    }

    return { serverScore: Math.max(0, score) };
}