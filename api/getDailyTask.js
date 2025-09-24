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

// --- 主处理函数 ---
export default async function handler(request, response) {
    const userId = 'user_default';
    const today = new Date().toISOString().split('T')[0];

    try {
        const settings = await kv.get(`user:${userId}:settings`) || { dailyGoal: 1 };
        
        const userWordKeys = await kv.keys(`user:${userId}:word:*`);
        const userProgressList = userWordKeys.length > 0 ? await kv.mget(...userWordKeys) : [];
        const allLearnedWords = userProgressList.filter(p => p).map(p => ({ 
            spanish: p.spanish, 
            english: p.english,
            exampleSentence: p.exampleSentence || '' 
        }));
        
        const reviewTasks = userProgressList
            .filter(p => p && p.reviewDate <= today)
            .map(p => ({ 
                type: 'review',
                spanish: p.spanish, 
                english: p.english, 
                exampleSentence: p.exampleSentence || ''
            }));

        let lastLearnedRecord = await kv.get(`user:${userId}:lastLearnedNewWord`);
        
        if (!lastLearnedRecord || lastLearnedRecord.date !== today || !Array.isArray(lastLearnedRecord.words)) {
            lastLearnedRecord = { date: today, words: [] };
        }

        // [重要修正] 在这里计算今天还需要学习多少个新词
        const wordsLearnedTodayCount = lastLearnedRecord.words.length;
        const wordsNeeded = settings.dailyGoal - wordsLearnedTodayCount;

        let newWordTasks = [];
        if (wordsNeeded > 0) {
            const currentlyKnownWords = allLearnedWords.map(w => w.spanish);
            // 将今天已经学过的词也加入排除列表，避免重复
            lastLearnedRecord.words.forEach(w => {
                if (!currentlyKnownWords.includes(w.spanish)) {
                    currentlyKnownWords.push(w.spanish);
                }
            });

            for (let i = 0; i < wordsNeeded; i++) {
                const nextWordToLearn = await getNewWordFromAI(currentlyKnownWords);
                if (!nextWordToLearn || nextWordToLearn.spanish === 'error') break;
                
                const aiExplanation = await getAITutorExplanation(nextWordToLearn);
                newWordTasks.push({ 
                    type: 'new',
                    ...nextWordToLearn, 
                    aiTutor: aiExplanation 
                });
                currentlyKnownWords.push(nextWordToLearn.spanish);
            }
        }
        
        const finalTaskQueue = [...newWordTasks, ...reviewTasks];

        response.status(200).json({
            taskQueue: finalTaskQueue,
            allLearnedWords: allLearnedWords,
            settings: settings,
            wordsLearnedToday: lastLearnedRecord.words
        });

    } catch (error) {
        console.error("Error in getDailyTask:", error);
        response.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}

