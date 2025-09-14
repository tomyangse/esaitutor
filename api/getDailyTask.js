import { kv } from '@vercel/kv';

// --- AI 助手函数 1: 动态选择一个新词 ---
// 这个函数负责根据用户已学单词列表，从AI获取一个全新的、常用的西班牙语单词。
async function getNewWordFromAI(learnedWordsList) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("Gemini API key is not set.");
        return { spanish: "error", english: "API key not configured" };
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const systemPrompt = `You are an AI language curriculum designer. Your task is to select a single, common, beginner-level Spanish word for a student to learn. The student has already learned the words provided in the user prompt. You MUST provide a word that is NOT on that list. Your response MUST be in JSON format with two keys: "spanish" and "english". Pick a very common word.`;

    const payload = {
        contents: [{
            parts: [{ text: `Learned words: ${JSON.stringify(learnedWordsList)}` }]
        }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
        generationConfig: {
            responseMimeType: "application/json",
        },
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
            return JSON.parse(jsonText);
        } else {
            throw new Error("Invalid response structure from Gemini API for new word selection");
        }
    } catch (error) {
        console.error("Error calling Gemini API for new word:", error);
        return { spanish: "error", english: "Failed to fetch new word" };
    }
}

// --- AI 助手函数 2: 生成AI老师的讲解 ---
// 这个函数接收一个单词，然后调用AI生成详细、友好的讲解。
async function getAITutorExplanation(word) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return { explanation: "AI讲解功能当前不可用，请检查API密钥配置。", exampleSentence: "N/A", sentenceTranslation: "N/A", extraTips: "请稍后再试。" };
    }
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

    const systemPrompt = `You are a friendly, patient, and encouraging Spanish tutor. Your student is a beginner. For the given Spanish word, provide a concise and easy-to-understand explanation in Chinese. Your response MUST be in JSON format and follow this exact schema:
1.  \`explanation\`: A simple definition of the word.
2.  \`exampleSentence\`: A common, practical example sentence using the word.
3.  \`sentenceTranslation\`: The English translation of the example sentence.
4.  \`extraTips\`: One extra useful tip, like a related word (antonym/synonym), a common mistake, or a cultural note.
Keep all explanations and examples suitable for a beginner.`;

    const payload = {
        contents: [{ parts: [{ text: `The word is: "${word.spanish}"` }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { responseMimeType: "application/json" },
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`API request failed with status ${response.status}`);
        const result = await response.json();
        const jsonText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
            return JSON.parse(jsonText);
        } else {
            throw new Error("Invalid response structure from Gemini API for explanation");
        }
    } catch (error) {
        console.error("Error calling Gemini API for explanation:", error);
        return { explanation: "调用AI老师功能时发生错误。", exampleSentence: "Error", sentenceTranslation: "Error", extraTips: error.message };
    }
}

// --- Vercel Serverless Function 主处理函数 ---
export default async function handler(request, response) {
    // 为简化，我们使用一个固定的用户ID。未来可以从请求中获取。
    const userId = 'user_default'; 
    const today = new Date().toISOString().split('T')[0];

    try {
        // 1. 获取所有学过的单词进度
        const userWordKeys = await kv.keys(`user:${userId}:word:*`);
        const userProgressList = userWordKeys.length > 0 ? await kv.mget(...userWordKeys) : [];

        // 2. 筛选出今天要复习的单词列表
        const reviewQueue = userProgressList.filter(p => p && p.reviewDate <= today);
        
        // 3. 检查今天是否已经分配过新词
        let newWordData = null;
        const lastLearnedDate = await kv.get(`user:${userId}:lastLearnedDate`);

        if (lastLearnedDate !== today) {
            // 如果今天还没学过新词，就去AI那里取一个
            const learnedWords = userProgressList.map(p => p ? p.spanish : null).filter(Boolean);
            const nextWordToLearn = await getNewWordFromAI(learnedWords);

            if (nextWordToLearn && nextWordToLearn.spanish !== 'error') {
                // 为新词调用AI老师进行讲解
                const aiExplanation = await getAITutorExplanation(nextWordToLearn);
                
                newWordData = {
                    ...nextWordToLearn,
                    aiTutor: aiExplanation
                };
                
                // 标记今天已经学习了新词，防止重复分配
                await kv.set(`user:${userId}:lastLearnedDate`, today);
            }
        }

        // 4. 返回最终结果给前端
        response.status(200).json({
            reviewQueue: reviewQueue,
            newWord: newWordData // 如果今天已学过，这里会是 null
        });

    } catch (error) {
        console.error("Error in getDailyTask:", error);
        response.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}

