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
        const userWordKeys = await kv.keys(`user:${userId}:word:*`);
        const userProgressList = userWordKeys.length > 0 ? await kv.mget(...userWordKeys) : [];
        const allLearnedWords = userProgressList.filter(p => p).map(p => ({ spanish: p.spanish, english: p.english }));
        const reviewQueue = userProgressList.filter(p => p && p.reviewDate <= today).map(p => ({ spanish: p.spanish, english: p.english }));

        const lastLearnedRecord = await kv.get(`user:${userId}:lastLearnedNewWord`);
        if (lastLearnedRecord && lastLearnedRecord.date === today) {
            
            let wordInfoFromList = userProgressList.find(p => p && p.spanish === lastLearnedRecord.spanishWord);
            
            // [重要修正] 自我修复逻辑
            if (wordInfoFromList && !wordInfoFromList.exampleSentence) {
                console.log(`Data self-healing: Fetching missing example sentence for "${wordInfoFromList.spanish}"`);
                const aiExplanation = await getAITutorExplanation(wordInfoFromList);
                wordInfoFromList.exampleSentence = aiExplanation.exampleSentence;

                // 更新数据库中的旧记录
                await kv.set(`user:${userId}:word:${wordInfoFromList.spanish}`, wordInfoFromList);
            }

            const learnedTodayData = {
                spanish: lastLearnedRecord.spanishWord,
                exampleSentence: wordInfoFromList ? wordInfoFromList.exampleSentence : '', 
                english: wordInfoFromList ? wordInfoFromList.english : ''
            };

            return response.status(200).json({
                learnedToday: learnedTodayData,
                reviewQueue: reviewQueue,
                allLearnedWords: allLearnedWords
            });
        }

        const nextWordToLearn = await getNewWordFromAI(allLearnedWords.map(w => w.spanish));
        if (!nextWordToLearn || nextWordToLearn.spanish === 'error') {
            throw new Error("Failed to fetch a new word from the AI.");
        }
        
        const aiExplanation = await getAITutorExplanation(nextWordToLearn);
        const newWordData = { ...nextWordToLearn, aiTutor: aiExplanation };

        response.status(200).json({
            newWord: newWordData,
            reviewQueue: reviewQueue,
            allLearnedWords: allLearnedWords
        });

    } catch (error) {
        console.error("Error in getDailyTask:", error);
        response.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}

