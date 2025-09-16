import { kv } from '@vercel/kv';

// --- AI 调用函数 (保持不变) ---
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
async function sendEmailWithBrevo({ subject, htmlContent, recipientEmail, senderEmail }) {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) { throw new Error("Brevo API key is not configured."); }
    const payload = { sender: { email: senderEmail, name: "AI Spanish Tutor" }, to: [{ email: recipientEmail }], subject: subject, htmlContent: htmlContent };
    const response = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'accept': 'application/json', 'api-key': apiKey, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) { const errorBody = await response.json(); console.error("Brevo API Error:", errorBody); throw new Error(`Failed to send email. Status: ${response.status}`); }
    return await response.json();
}
function createGoogleCalendarLink(newWord, reviewList, platformUrl) {
    const today = new Date();
    const startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0);
    const endTime = new Date(startTime.getTime() + 15 * 60000);
    const formatDate = (date) => date.toISOString().replace(/-|:|\.\d{3}/g, '');
    const eventDetails = `今日新词: ${newWord.spanish}\\n\\n复习单词:\\n${reviewList.join(', ')}\\n\\n点击链接开始学习:\\n${platformUrl}`;
    const params = new URLSearchParams({ action: 'TEMPLATE', text: `每日西语学习: ${newWord.spanish}`, dates: `${formatDate(startTime)}/${formatDate(endTime)}`, details: eventDetails, location: platformUrl });
    return `https://www.google.com/calendar/render?${params.toString()}`;
}


// --- 主处理函数 (由 Vercel Cron Job 每日触发) ---
export default async function handler(request, response) {
    if (request.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
        return response.status(401).end('Unauthorized');
    }
    
    const userId = 'user_default'; 
    const todayStr = new Date().toISOString().split('T')[0];

    try {
        const userWordKeys = await kv.keys(`user:${userId}:word:*`);
        const userProgressList = userWordKeys.length > 0 ? await kv.mget(...userWordKeys) : [];
        const reviewQueue = userProgressList.filter(p => p && p.reviewDate <= todayStr).map(p => p.spanish);
        const learnedWords = userProgressList.map(p => p ? p.spanish : null).filter(Boolean);

        let newWord;
        let isNewWordFromEmail = false;
        
        const lastLearnedRecord = await kv.get(`user:${userId}:lastLearnedNewWord`);
        if (lastLearnedRecord && lastLearnedRecord.date === todayStr) {
            console.log(`Email cron: Found word learned today - ${lastLearnedRecord.spanishWord}`);
            const wordInfo = userProgressList.find(p => p.spanish === lastLearnedRecord.spanishWord);
            newWord = { spanish: wordInfo.spanish, english: wordInfo.english };
        } else {
            console.log("Email cron: No word learned today, fetching a new one for reminder.");
            newWord = await getNewWordFromAI(learnedWords);
            isNewWordFromEmail = true;
        }

        if (!newWord || newWord.spanish === 'error') throw new Error("Failed to get a new word for the email.");
        
        // [重要更新] 如果是邮件脚本第一次生成了新词，立刻把它存到数据库
        if (isNewWordFromEmail) {
            console.log(`Email cron: Setting today's new word to "${newWord.spanish}" in the database.`);
            await kv.set(`user:${userId}:lastLearnedNewWord`, { spanishWord: newWord.spanish, date: todayStr });
        }
        
        const aiTutor = await getAITutorExplanation(newWord);
        const chineseMeaning = aiTutor.explanation.split('，')[0];
        
        const platformUrl = process.env.PLATFORM_URL || 'http://localhost:3000';
        const googleCalendarLink = createGoogleCalendarLink(newWord, reviewQueue, platformUrl);

        await sendEmailWithBrevo({
            subject: `🇪🇸 你的每日西班牙语单词: ${newWord.spanish}`,
            htmlContent: `
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
            recipientEmail: process.env.RECIPIENT_EMAIL,
            senderEmail: process.env.SENDER_EMAIL
        });

        response.status(200).json({ success: true, message: 'Reminder email sent with consistent logic.' });
    } catch (error) {
        console.error("Error in daily-reminder cron job:", error);
        response.status(500).json({ success: false, error: error.message });
    }
}

