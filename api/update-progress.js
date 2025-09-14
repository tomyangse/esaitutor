import { kv } from '@vercel/kv';

// --- Vercel Serverless Function 主处理函数 ---
export default async function handler(request, response) {
    // 确保只接受POST请求
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 1. 从前端请求中获取数据
        const { spanish, english, quality } = request.body;
        // quality: 3(忘记了), 4(有点难), 5(记住了)

        // 数据验证
        if (!spanish || !english || !quality) {
            return response.status(400).json({ error: 'Missing required parameters' });
        }

        const userId = 'user_default';
        // 数据库中的键，用西班牙语单词本身作为唯一标识
        const key = `user:${userId}:word:${spanish}`;

        // 2. 从数据库获取该单词当前的进度
        let progress = await kv.get(key);

        // 如果是新词，则初始化其进度
        if (!progress) {
            progress = {
                spanish: spanish,
                english: english,
                repetitions: 0,      // 连续答对次数
                interval: 1,         // 下次复习间隔（天）
                easeFactor: 2.5,     // 简易度因子 (初始值2.5)
            };
        }

        // 3. 核心：基于SM-2算法的简化版间隔重复逻辑
        if (quality < 4) { 
            // 如果回答 "忘记了" (quality < 4)
            // 重置连续答对次数，并将复习间隔设回1天
            progress.repetitions = 0;
            progress.interval = 1;
        } else { 
            // 如果回答 "有点难" 或 "记住了" (quality >= 4)
            progress.repetitions += 1; // 连续答对次数加1

            // 根据连续答对次数更新间隔
            if (progress.repetitions === 1) {
                progress.interval = 1;
            } else if (progress.repetitions === 2) {
                progress.interval = 6;
            } else {
                // 核心公式：上一次的间隔 * 简易度因子
                progress.interval = Math.ceil(progress.interval * progress.easeFactor);
            }

            // 根据本次回答的难易程度，微调简易度因子
            // "记住了"(5)会增加因子，"有点难"(4)会稍微减少
            progress.easeFactor = progress.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
            
            // 确保简易度因子不会低于1.3，防止间隔无限缩小
            if (progress.easeFactor < 1.3) {
                progress.easeFactor = 1.3;
            }
        }
        
        // 4. 计算下一次的复习日期
        const nextReviewDate = new Date();
        nextReviewDate.setDate(nextReviewDate.getDate() + progress.interval);
        // 格式化为 YYYY-MM-DD
        progress.reviewDate = nextReviewDate.toISOString().split('T')[0];

        // 5. 将更新后的进度存回数据库
        await kv.set(key, progress);

        // 6. 向前端返回成功响应
        response.status(200).json({ success: true, newProgress: progress });

    } catch (error) {
        console.error("Error in update-progress:", error);
        response.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
