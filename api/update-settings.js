import { kv } from '@vercel/kv';

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).end();
    }

    const { dailyGoal } = request.body;
    const userId = 'user_default';
    const settingsKey = `user:${userId}:settings`;

    // 验证输入
    const validGoals = [1, 2, 3, 5];
    if (!validGoals.includes(dailyGoal)) {
        return response.status(400).json({ error: 'Invalid daily goal value.' });
    }

    try {
        const currentSettings = await kv.get(settingsKey) || {};
        const newSettings = { ...currentSettings, dailyGoal };
        await kv.set(settingsKey, newSettings);
        response.status(200).json({ success: true, settings: newSettings });
    } catch (error) {
        console.error("Error updating settings:", error);
        response.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}

