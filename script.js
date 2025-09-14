document.addEventListener('DOMContentLoaded', () => {
    // --- 元素获取 ---
    const speakButton = document.getElementById('speak-button');
    const markAsLearnedBtn = document.getElementById('mark-as-learned-btn');
    const showAnswerBtn = document.getElementById('show-answer-btn');
    const feedbackButtons = document.getElementById('feedback-buttons');

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

    function speak(text, lang = 'es-ES', onEndCallback) {
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
        utterance.onstart = () => speakButton.classList.add('speaking');
        utterance.onend = () => {
            speakButton.classList.remove('speaking');
            if (onEndCallback) onEndCallback();
        };
        window.speechSynthesis.speak(utterance);
    }
    
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // --- UI 更新函数 ---
    /**
     * [重要修正] 使用更简单、更健壮的逻辑来显示指定的卡片状态
     * @param {string} stateToShow - 要显示的状态ID
     */
    function showState(stateToShow) {
        const allStateIds = [
            'loading-state', 
            'error-state', 
            'finished-state', 
            'new-word-section', 
            'review-section'
        ];
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
            console.error('Frontend fetch timed out after 25 seconds.');
            showState('error-state');
        }, 25000);

        try {
            const response = await fetch('/api/getDailyTask', { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`Network response was not ok. Status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.newWord) {
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
            if (error.name === 'AbortError') {
                return;
            }
            console.error('Fetch error:', error);
            showState('error-state');
        }
    }

    async function updateProgress(word, quality) {
        try {
            await fetch('/api/update-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ spanishWord: word, quality: quality })
            });
        } catch (error) {
            console.error('Update progress error:', error);
        }
    }

    // --- 事件监听 ---
    markAsLearnedBtn.addEventListener('click', async () => {
        await updateProgress(currentTask.newWord.spanish, 5);
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
            speak(word, 'es-ES', () => {
                setTimeout(() => speak(sentence, 'es-ES'), 300);
            });
        } else if (word) {
            speak(word, 'es-ES');
        }
    });

    // --- 应用启动 ---
    fetchDailyTask();
});

