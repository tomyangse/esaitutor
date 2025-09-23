document.addEventListener('DOMContentLoaded', () => {
    // --- 元素获取 ---
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const difficultyOptions = document.querySelector('.difficulty-options');
    const settingsFeedback = document.getElementById('settings-feedback');
    const speakButton = document.getElementById('speak-button');
    const markAsLearnedBtn = document.getElementById('mark-as-learned-btn');
    const showAnswerBtn = document.getElementById('show-answer-btn');
    const feedbackButtons = document.getElementById('feedback-buttons');
    const speakLearnedTodayBtn = document.getElementById('speak-learned-today-btn');
    const learnedWordsContainer = document.getElementById('learned-words-container');
    const toggleWordsBtn = document.getElementById('toggle-words-btn');
    const learnedWordsList = document.getElementById('learned-words-list');

    // --- 状态变量 ---
    let currentTask = null;
    let taskQueue = [];
    let spanishVoices = [];

    // --- 语音模块 ---
    function loadVoices() {
        const voices = window.speechSynthesis.getVoices();
        spanishVoices = voices.filter(voice => voice.lang.startsWith('es'));
    }
    function speak(text, lang, buttonElement, onEndCallback) {
        if (!window.speechSynthesis) return;
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        const preferredVoice = spanishVoices.find(v => v.lang === 'es-ES') || spanishVoices.find(v => v.lang === 'es-MX') || spanishVoices[0];
        if (preferredVoice) utterance.voice = preferredVoice;
        utterance.onstart = () => buttonElement && buttonElement.classList.add('speaking');
        utterance.onend = () => {
            buttonElement && buttonElement.classList.remove('speaking');
            if (onEndCallback) onEndCallback();
        };
        window.speechSynthesis.speak(utterance);
    }
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // --- UI 更新 ---
    function showState(stateToShow) {
        const allStateIds = ['loading-state', 'error-state', 'learned-today-section', 'finished-state', 'new-word-section', 'review-section'];
        allStateIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) element.style.display = (id === stateToShow) ? 'block' : 'none';
        });
    }
    function showNewWord(task) {
        showState('new-word-section');
        document.getElementById('new-word-spanish').textContent = task.spanish;
        const { explanation, exampleSentence, extraTips } = task.aiTutor;
        document.getElementById('ai-explanation').textContent = explanation || '暂无讲解';
        document.getElementById('ai-example').textContent = exampleSentence || '暂无例句';
        document.getElementById('ai-tips').textContent = extraTips || '暂无提示';
    }
    function showReviewWord(word) {
        showState('review-section');
        document.getElementById('review-word-spanish').textContent = word.spanish;
        document.getElementById('review-word-english').textContent = word.english;
        document.getElementById('review-word-english').style.visibility = 'hidden';
        showAnswerBtn.style.display = 'block';
        feedbackButtons.style.display = 'none';
    }
    function showLearnedToday(words) {
        showState('learned-today-section');
        // 只显示今天学的最后一个词作为代表
        const lastWord = words[words.length - 1];
        document.getElementById('learned-today-word').textContent = lastWord.spanish;
        document.getElementById('learned-today-sentence').textContent = lastWord.exampleSentence || '';
    }
    function populateLearnedWordsList(words) {
        if (!words || words.length === 0) {
            learnedWordsContainer.style.display = 'none';
            return;
        }
        learnedWordsContainer.style.display = 'block';
        learnedWordsList.innerHTML = '';
        words.forEach(word => {
            const item = document.createElement('div');
            item.className = 'word-item';
            item.innerHTML = `<span class="spanish">${word.spanish}</span><span class="english">${word.english}</span>`;
            learnedWordsList.appendChild(item);
        });
    }

    // --- 核心逻辑 ---
    function processNextTask() {
        if (taskQueue.length > 0) {
            currentTask = taskQueue.shift();
            if (currentTask.type === 'new') {
                showNewWord(currentTask);
            } else {
                showReviewWord(currentTask);
            }
        } else {
            showState('finished-state');
        }
    }
    
    async function fetchDailyTask() {
        showState('loading-state');
        try {
            const response = await fetch('/api/getDailyTask');
            if (!response.ok) throw new Error('Network error');
            const data = await response.json();

            populateLearnedWordsList(data.allLearnedWords);
            updateSettingsUI(data.settings.dailyGoal);

            const newWordTasks = (data.newWords || []).map(word => ({ ...word, type: 'new' }));
            const reviewTasks = (data.reviewQueue || []).map(word => ({ ...word, type: 'review' }));
            taskQueue = [...newWordTasks, ...reviewTasks];

            if (taskQueue.length > 0) {
                processNextTask();
            } else if (data.wordsLearnedToday && data.wordsLearnedToday.length > 0) {
                showLearnedToday(data.wordsLearnedToday);
            } else {
                showState('finished-state');
            }
        } catch (error) {
            console.error('Fetch error:', error);
            showState('error-state');
        }
    }

    async function updateProgress(task) {
        const payload = {
            spanishWord: task.spanish,
            quality: task.quality,
            englishWord: task.english,
            exampleSentence: task.aiTutor ? task.aiTutor.exampleSentence : (task.exampleSentence || null)
        };
        try {
            await fetch('/api/update-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) { console.error('Update progress error:', error); }
    }

    // --- 设置模块 ---
    function openSettingsModal() { settingsModal.style.display = 'flex'; }
    function closeSettingsModal() { settingsModal.style.display = 'none'; }
    function updateSettingsUI(goal) {
        document.querySelectorAll('.difficulty-btn').forEach(btn => {
            btn.classList.toggle('selected', parseInt(btn.dataset.goal) === goal);
        });
    }
    async function saveSettings(dailyGoal) {
        try {
            const response = await fetch('/api/update-settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dailyGoal })
            });
            if (response.ok) {
                settingsFeedback.textContent = '设置已保存！刷新后生效。';
                setTimeout(() => window.location.reload(), 1500);
            }
        } catch (error) {
            settingsFeedback.textContent = '保存失败，请重试。';
        }
    }

    // --- 事件监听 ---
    settingsBtn.addEventListener('click', openSettingsModal);
    closeModalBtn.addEventListener('click', closeSettingsModal);
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
    });
    difficultyOptions.addEventListener('click', (e) => {
        if (e.target.classList.contains('difficulty-btn')) {
            const goal = parseInt(e.target.dataset.goal);
            updateSettingsUI(goal);
            saveSettings(goal);
        }
    });

    markAsLearnedBtn.addEventListener('click', async () => {
        await updateProgress({ ...currentTask, quality: 5 });
        processNextTask();
    });

    showAnswerBtn.addEventListener('click', () => {
        document.getElementById('review-word-english').style.visibility = 'visible';
        showAnswerBtn.style.display = 'none';
        feedbackButtons.style.display = 'flex';
    });

    feedbackButtons.addEventListener('click', async (e) => {
        if (e.target.classList.contains('feedback-btn')) {
            const quality = parseInt(e.target.dataset.quality, 10);
            await updateProgress({ ...currentTask, quality: quality });
            processNextTask();
        }
    });
    
    toggleWordsBtn.addEventListener('click', () => {
        learnedWordsList.classList.toggle('words-list-hidden');
        toggleWordsBtn.classList.toggle('open');
    });

    speakButton.addEventListener('click', () => {
        if (!currentTask || currentTask.type !== 'new') return;
        const word = currentTask.spanish;
        const sentence = currentTask.aiTutor.exampleSentence;
        if (word && sentence) {
            speak(word, 'es-ES', speakButton, () => setTimeout(() => speak(sentence, 'es-ES', speakButton), 300));
        } else if (word) {
            speak(word, 'es-ES', speakButton);
        }
    });

    speakLearnedTodayBtn.addEventListener('click', () => {
        const word = document.getElementById('learned-today-word').textContent;
        const sentence = document.getElementById('learned-today-sentence').textContent;
        if (word && sentence) {
            speak(word, 'es-ES', speakLearnedTodayBtn, () => setTimeout(() => speak(sentence, 'es-ES', speakLearnedTodayBtn), 300));
        } else if (word) {
            speak(word, 'es-ES', speakLearnedTodayBtn);
        }
    });

    fetchDailyTask(); // 启动
});

