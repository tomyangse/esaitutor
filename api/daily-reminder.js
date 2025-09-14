import { kv } from '@vercel/kv';
import nodemailer from 'nodemailer'; // 用于发送邮件的库

// --- 注意: 为了保持每个API文件的独立性，我们在这里重新定义了AI调用函数 ---
// 在大型项目中，建议将这些函数提取到共享的 /lib 目录中。

async function getNewWordFromAI(learnedWordsList) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { spanish: "error", english: "API key not configured" };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    const systemPrompt = `You are an AI language curriculum designer. Your task is to select a single, common, beginner-level Spanish word for a student to learn. The student has already learned the words provided in the user prompt. You MUST provide a word that is NOT on that list. Your response MUST be in JSON format with two keys: "spanish" and "english". Pick a very common word.`;
    const payload = { contents: [{ parts: [{ text: `Learned words: ${JSON.stringify(learnedWordsList)}` }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json" } };
    try {
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) return JSON.parse(jsonText);
        else throw new Error("Invalid response structure from Gemini API");
    } catch (error) {
        console.error("Error calling Gemini API for new word:", error);
        return { spanish: "error", english: "Failed to fetch" };
    }
}

async function getAITutorExplanation(word) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { explanation: "AI讲解功能当前不可用。", exampleSentence: "N/A", sentenceTranslation: "N/A", extraTips: "请检查API密钥配置。" };
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
    const systemPrompt = `You are a friendly, patient, and encouraging Spanish tutor. Your student is a beginner. For the given Spanish word, provide a concise and easy-to-understand explanation in Chinese. Your response MUST be in JSON format and follow this exact schema: 1. \`explanation\`: A simple definition. 2. \`exampleSentence\`: A practical example sentence. 3. \`sentenceTranslation\`: The English translation of the sentence. 4. \`extraTips\`: One extra useful tip.`;
    const payload = { contents: [{ parts: [{ text: `The word is: "${word.spanish}"` }] }], systemInstruction: { parts: [{ text: systemPrompt }] }, generationConfig: { responseMimeType: "application/json" } };
    try {
        const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) return JSON.parse(jsonText);
        else throw new Error("Invalid response structure from Gemini API");
    } catch (error) {
        console.error("Error calling Gemini API for explanation:", error);
        return { explanation: "调用AI老师功能时发生错误。", exampleSentence: "Error", sentenceTranslation: "Error", extraTips: error.message };
    }
}

// --- Google Calendar 链接生成函数 ---
function createGoogleCalendarLink(newWord, reviewList, platformUrl) {
    const today = new Date();
    const startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0); // 设置为今天上午10点
    const endTime = new Date(startTime.getTime() + 15 * 60000); // 学习15分钟
    const formatDate = (date) => date.toISOString().replace(/-|:|\.\d{3}/g, '');
    const eventDetails = `今日新词: ${newWord.spanish}\\n\\n复习单词:\\n${reviewList.join(', ')}\\n\\n点击链接开始学习:\\n${platformUrl}`;
    const params = new URLSearchParams({ action: 'TEMPLATE', text: `每日西语学习: ${newWord.spanish}`, dates: `${formatDate(startTime)}/${formatDate(endTime)}`, details: eventDetails, location: platformUrl });
    return `https://www.google.com/calendar/render?${params.toString()}`;
}

// --- 主处理函数 (由 Vercel Cron Job 每日触发) ---
export default async function handler(request, response) {
    // 安全验证：确保请求来自Vercel的Cron服务
    if (request.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        return response.status(401).end('Unauthorized');
    }
    
    const userId = 'user_default'; 
    const todayStr = new Date().toISOString().split('T')[0];

    try {
        // 1. 获取所有学过的单词并计算复习队列
        const userWordKeys = await kv.keys(`user:${userId}:word:*`);
        const userProgressList = userWordKeys.length > 0 ? await kv.mget(...userWordKeys) : [];
        const reviewQueue = userProgressList.filter(p => p && p.reviewDate <= todayStr).map(p => p.spanish);

        // 2. 获取今天的新词和AI讲解
        const learnedWords = userProgressList.map(p => p ? p.spanish : null).filter(Boolean);
        const newWord = await getNewWordFromAI(learnedWords);
        if (!newWord || newWord.spanish === 'error') throw new Error("Failed to get a new word from AI.");
        const aiTutor = await getAITutorExplanation(newWord);
        const chineseMeaning = aiTutor.explanation.split('，')[0];

        // 3. 配置邮件服务
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.GMAIL_EMAIL, pass: process.env.GMAIL_APP_PASSWORD },
        });

        const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
        const googleCalendarLink = createGoogleCalendarLink(newWord, reviewQueue, platformUrl);

        // 4. 编写并发送邮件
        const mailOptions = {
            from: process.env.GMAIL_EMAIL,
            to: process.env.GMAIL_EMAIL, // 发送给自己
            subject: `🇪🇸 你的每日西班牙语单词: ${newWord.spanish}`,
            html: `
                <div style="font-family: sans-serif; line-height: 1.6;">
                    <h2>¡Hola! 这是你的每日西班牙语课程 ☀️</h2>
                    <p>坚持就是胜利！这是今天的学习任务：</p>
                    <hr>
                    <h3>✨ 今日新词</h3>
                    <p style="font-size: 1.2em;"><strong>${newWord.spanish}</strong> - ${newWord.english} (${chineseMeaning})</p>
                    <h3>📚 今日复习</h3>
                    <p>${reviewQueue.length > 0 ? reviewQueue.join(', ') : '今天没有需要复习的单词，太棒了！'}</p>
                    <hr>
                    <p style="text-align: center; margin: 20px 0;">
                        <a href="${platformUrl}" style="background-color: #007bff; color: white; padding: 12px 22px; text-decoration: none; border-radius: 5px; font-size: 16px;">进入平台深入学习</a>
                    </p>
                    <p style="text-align: center; font-size: 14px;">
                         <a href="${googleCalendarLink}" target="_blank">一键添加到谷歌日历</a>
                    </p>
                </div>
            `,
        };

        await transporter.sendMail(mailOptions);
        response.status(200).json({ success: true, message: 'Reminder email sent.' });

    } catch (error) {
        console.error("Error in daily-reminder cron job:", error);
        response.status(500).json({ success: false, error: error.message });
    }
}

