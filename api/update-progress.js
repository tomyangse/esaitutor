import { kv } from '@vercel/kv';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).end();
    }

    // 从请求中获取 englishWord
    const { spanishWord, quality, englishWord } = request.body;
    const userId = 'user_default';
    const key = `user:${userId}:word:${spanishWord}`;

    let progress = await kv.get(key);

    if (!progress) {
        // 这是新词，必须保存其西班牙语和英语原文
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
    if (quality < 4) { // 如果回答错误 (Forgot 或 Hard)
        progress.repetitions = 0; // 重置连续答对次数
        progress.interval = 1; // 下次复习间隔重置为1天
    } else { // 如果回答正确 (Good)
        progress.repetitions += 1;
        if (progress.repetitions === 1) {
            progress.interval = 1;
        } else if (progress.repetitions === 2) {
            progress.interval = 6;
        } else {
            progress.interval = Math.ceil(progress.interval * progress.easeFactor);
        }
        
        // 更新简易度因子 (easeFactor)
        progress.easeFactor += (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
        if (progress.easeFactor < 1.3) {
            progress.easeFactor = 1.3;
        }
    }
    
    // 计算下一次复习日期
    const nextReviewDate = new Date();
    nextReviewDate.setDate(nextReviewDate.getDate() + progress.interval);
    progress.reviewDate = nextReviewDate.toISOString().split('T')[0];

    // 将更新后的完整进度对象存回数据库
    await kv.set(key, progress);

    response.status(200).json({ success: true, newProgress: progress });
}

