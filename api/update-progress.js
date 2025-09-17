import { kv } from '@vercel/kv';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).end();
    }

    const { spanishWord, quality, englishWord } = request.body;
    const userId = 'user_default';
    const key = `user:${userId}:word:${spanishWord}`;

    let progress = await kv.get(key);
    const isNewWord = !progress;

    if (isNewWord) {
        if (!englishWord) {
            return response.status(400).json({ error: 'English translation is required for a new word.' });
        }
        progress = {
            spanish: spanishWord,
            english: englishWord,
            repetitions: 0,
            interval: 1,
            easeFactor: 2.5,
        };
    }

    // --- SM-2 间隔重复算法核心逻辑 ---
    if (quality < 4) {
        progress.repetitions = 0;
        progress.interval = 1;
    } else {
        progress.repetitions += 1;
        if (progress.repetitions === 1) {
            progress.interval = 1;
        } else if (progress.repetitions === 2) {
            progress.interval = 6;
        } else {
            progress.interval = Math.ceil(progress.interval * progress.easeFactor);
        }
        
        progress.easeFactor += (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (progress.easeFactor < 1.3) {
            progress.easeFactor = 1.3;
        }
    }
    
    const today = new Date();
    const nextReviewDate = new Date(today);
    nextReviewDate.setDate(today.getDate() + progress.interval);
    progress.reviewDate = nextReviewDate.toISOString().split('T')[0];

    // [重要更新] 如果是新学的单词，就盖上“特殊印章”
    if (isNewWord) {
        const todayStr = today.toISOString().split('T')[0];
        await kv.set(`user:${userId}:lastLearnedNewWord`, { spanishWord: spanishWord, date: todayStr });
    }

    await kv.set(key, progress);

    response.status(200).json({ success: true, newProgress: progress });
}


