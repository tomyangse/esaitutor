document.addEventListener('DOMContentLoaded', () => {
    // --- 元素获取 ---
    const learnedWordsContainer = document.getElementById('learned-words-container');
    const toggleWordsBtn = document.getElementById('toggle-words-btn');
    const learnedWordsList = document.getElementById('learned-words-list');
    const speakButton = document.getElementById('speak-button');
    const markAsLearnedBtn = document.getElementById('mark-as-learned-btn');
    const showAnswerBtn = document.getElementById('show-answer-btn');
    const feedbackButtons = document.getElementById('feedback-buttons');
    const speakLearnedTodayBtn = document.getElementById('speak-learned-today-btn');

    // --- 状态变量 ---
    let currentTask = null;
    let taskQueue = [];
    let spanishVoices = [];

    // --- 语音合成模块 ---
    function loadVoices() {
        const voices = window.speechSynthesis.getVoices();
        spanishVoices = voices.filter(voice => voice.lang.startsWith('es'));
        if (spanishVoices.length === 0 && voices.length > 0) {
            console.warn("未找到西班牙语语音包，将使用默认语音。");
        }
    }
    
    function speak(text, lang = 'es-ES', buttonElement, onEndCallback) {
        if (!window.speechSynthesis) {
            alert('抱歉，您的浏览器不支持语音朗读功能。');
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        const preferredVoice = spanishVoices.find(v => v.lang === 'es-ES') || spanishVoices.find(v => v.lang === 'es-MX') || spanishVoices[0];
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
        
        utterance.onstart = () => {
            if (buttonElement) buttonElement.classList.add('speaking');
        };
        utterance.onend = () => {
            if (buttonElement) buttonElement.classList.remove('speaking');
            if (onEndCallback) onEndCallback();
        };
        window.speechSynthesis.speak(utterance);
    }
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // --- UI 更新函数 ---
    function showState(stateToShow) {
        const allStateIds = ['loading-state', 'error-state', 'learned-today-section', 'finished-state', 'new-word-section', 'review-section'];
        allStateIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.style.display = (id === stateToShow) ? 'block' : 'none';
            }
        });
    }

    function showNewWord(task) {
        showState('new-word-section');
        document.getElementById('new-word-spanish').textContent = task.newWord.spanish;
        const aiTutor = task.newWord.aiTutor;
        document.getElementById('ai-explanation').textContent = aiTutor.explanation || '暂无讲解';
        document.getElementById('ai-example').textContent = aiTutor.exampleSentence || '暂无例句';
        document.getElementById('ai-tips').textContent = aiTutor.extraTips || '暂无提示';
    }

    function showReviewWord(word) {
        showState('review-section');
        document.getElementById('review-word-spanish').textContent = word.spanish;
        document.getElementById('review-word-english').textContent = word.english;
        document.getElementById('review-word-english').style.visibility = 'hidden';
        showAnswerBtn.style.display = 'block';
        feedbackButtons.style.display = 'none';
    }

    function showLearnedToday(task) {
        showState('learned-today-section');
        document.getElementById('learned-today-word').textContent = task.learnedToday.spanish;
        document.getElementById('learned-today-sentence').textContent = task.learnedToday.exampleSentence || '';
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
            item.innerHTML = `
                <span class="spanish">${word.spanish}</span>
                <span class="english">${word.english}</span>
            `;
            learnedWordsList.appendChild(item);
        });
    }

    // --- 核心逻辑 ---
    function processNextTask() {
        if (taskQueue.length > 0) {
            currentTask = taskQueue.shift();
            showReviewWord(currentTask);
        } else {
            showState('finished-state');
        }
    }
    
    async function fetchDailyTask() {
        showState('loading-state');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            console.error('Frontend fetch timed out');
            showState('error-state');
        }, 25000);

        try {
            const response = await fetch('/api/getDailyTask', { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`Network response was not ok`);
            
            const data = await response.json();
            
            populateLearnedWordsList(data.allLearnedWords);

            if (data.learnedToday) {
                taskQueue = data.reviewQueue || [];
                if (taskQueue.length > 0) {
                    processNextTask();
                } else {
                    showLearnedToday(data);
                }
            } else if (data.newWord) {
                currentTask = data;
                taskQueue = data.reviewQueue || [];
                showNewWord(data);
            } else if (data.reviewQueue && data.reviewQueue.length > 0) {
                taskQueue = data.reviewQueue;
                processNextTask();
            } else {
                showState('finished-state');
            }
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') return;
            console.error('Fetch error:', error);
            showState('error-state');
        }
    }

    async function updateProgress(spanishWord, quality, englishWord = null, exampleSentence = null) {
        const payload = { spanishWord, quality };
        if (englishWord) {
            payload.englishWord = englishWord;
        }
        if (exampleSentence) {
            payload.exampleSentence = exampleSentence;
        }
        try {
            await fetch('/api/update-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            console.error('Update progress error:', error);
        }
    }

    // --- 事件监听 ---
    toggleWordsBtn.addEventListener('click', () => {
        learnedWordsList.classList.toggle('words-list-hidden');
        toggleWordsBtn.classList.toggle('open');
    });

    markAsLearnedBtn.addEventListener('click', async () => {
        const newWordInfo = currentTask.newWord;
        await updateProgress(newWordInfo.spanish, 5, newWordInfo.english, newWordInfo.aiTutor.exampleSentence);
        
        const newWord = { spanish: newWordInfo.spanish, english: newWordInfo.english };
        const currentList = Array.from(learnedWordsList.children).map(item => ({
            spanish: item.querySelector('.spanish').textContent,
            english: item.querySelector('.english').textContent
        }));
        populateLearnedWordsList([newWord, ...currentList]);
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
            await updateProgress(currentTask.spanish, quality);
            processNextTask();
        }
    });
    
    speakButton.addEventListener('click', () => {
        if (!currentTask || !currentTask.newWord) return;
        const word = currentTask.newWord.spanish;
        const sentence = currentTask.newWord.aiTutor.exampleSentence;
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

    // --- 应用启动 ---
    fetchDailyTask();
});

