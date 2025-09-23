import { kv } from '@vercel/kv';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).end();
    }

    const { spanishWord, quality, englishWord, exampleSentence } = request.body;
    const userId = 'user_default';
    const wordKey = `user:${userId}:word:${spanishWord}`;
    const dailyRecordKey = `user:${userId}:lastLearnedNewWord`;

    let progress = await kv.get(wordKey);
    const isNewWord = !progress;

    if (isNewWord) {
        if (!englishWord) {
            return response.status(400).json({ error: 'English translation is required for a new word.' });
        }
        progress = {
            spanish: spanishWord,
            english: englishWord,
            exampleSentence: exampleSentence || '',
            repetitions: 0,
            interval: 1,
            easeFactor: 2.5,
        };
    } else {
        // 如果是旧词，确保它有 exampleSentence 字段
        if (!progress.hasOwnProperty('exampleSentence')) {
            progress.exampleSentence = '';
        }
    }

    // --- SM-2 间隔重复算法核心逻辑 ---
    if (quality < 4) {
        progress.repetitions = 0;
        progress.interval = 1;
    } else {
        progress.repetitions += 1;
        if (progress.repetitions === 1) progress.interval = 1;
        else if (progress.repetitions === 2) progress.interval = 6;
        else progress.interval = Math.ceil(progress.interval * progress.easeFactor);
        
        progress.easeFactor += (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (progress.easeFactor < 1.3) progress.easeFactor = 1.3;
    }
    
    const today = new Date();
    const nextReviewDate = new Date(today);
    nextReviewDate.setDate(today.getDate() + progress.interval);
    progress.reviewDate = nextReviewDate.toISOString().split('T')[0];
    
    // 更新今日已学单词列表
    if (isNewWord) {
        const todayStr = today.toISOString().split('T')[0];
        let dailyRecord = await kv.get(dailyRecordKey);

        if (!dailyRecord || dailyRecord.date !== todayStr) {
            dailyRecord = { date: todayStr, words: [] };
        }
        
        if (!dailyRecord.words.find(w => w.spanish === spanishWord)) {
            dailyRecord.words.push({ 
                spanish: spanishWord, 
                english: englishWord, 
                exampleSentence: exampleSentence || '' 
            });
        }
        await kv.set(dailyRecordKey, dailyRecord);
    }

    await kv.set(wordKey, progress);

    response.status(200).json({ success: true, newProgress: progress });
}

