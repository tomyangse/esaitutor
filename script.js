document.addEventListener('DOMContentLoaded', () => {
    // --- 元素获取 ---
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const finishedState = document.getElementById('finished-state');
    const newWordSection = document.getElementById('new-word-section');
    const reviewSection = document.getElementById('review-section');
    const speakButton = document.getElementById('speak-button'); // 获取朗读按钮

    const markAsLearnedBtn = document.getElementById('mark-as-learned-btn');
    const showAnswerBtn = document.getElementById('show-answer-btn');
    const feedbackButtons = document.getElementById('feedback-buttons');

    // --- 状态变量 ---
    let currentTask = null;
    let taskQueue = [];
    let spanishVoices = [];

    // --- 语音合成模块 ---

    /**
     * 加载并筛选可用的西班牙语语音包
     */
    function loadVoices() {
        const voices = window.speechSynthesis.getVoices();
        spanishVoices = voices.filter(voice => voice.lang.startsWith('es'));
        if (spanishVoices.length === 0 && voices.length > 0) {
            console.warn("未找到西班牙语语音包，将使用默认语音。");
        }
    }

    /**
     * 朗读指定的文本
     * @param {string} text - 要朗读的文本
     * @param {string} lang - 语言代码 (例如 'es-ES')
     * @param {Function} onEndCallback - 朗读结束后的回调函数
     */
    function speak(text, lang = 'es-ES', onEndCallback) {
        if (!window.speechSynthesis) {
            alert('抱歉，您的浏览器不支持语音朗读功能。');
            return;
        }
        
        window.speechSynthesis.cancel(); // 停止任何正在进行的朗读

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;

        // 优先选择西班牙的西班牙语，其次是墨西哥的
        const preferredVoice = spanishVoices.find(v => v.lang === 'es-ES') || spanishVoices.find(v => v.lang === 'es-MX') || spanishVoices[0];

        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }

        utterance.onstart = () => {
            speakButton.classList.add('speaking');
        };
        
        utterance.onend = () => {
            speakButton.classList.remove('speaking');
            if (onEndCallback) {
                onEndCallback();
            }
        };
        
        window.speechSynthesis.speak(utterance);
    }
    
    // 初始化语音功能
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }


    // --- UI 更新函数 ---

    /**
     * 显示指定的卡片状态
     * @param {string} state - 要显示的状态ID
     */
    function showState(state) {
        ['loading-state', 'error-state', 'finished-state', 'new-word-section', 'review-section'].forEach(id => {
            document.getElementById(id.replace('-state', '-section')).style.display = (id === state) ? 'block' : 'none';
        });
    }

    /**
     * 显示新词卡片
     * @param {object} task - 包含新词信息的任务对象
     */
    function showNewWord(task) {
        showState('new-word-section');
        document.getElementById('new-word-spanish').textContent = task.newWord.spanish;
        const aiTutor = task.newWord.aiTutor;
        document.getElementById('ai-explanation').textContent = aiTutor.explanation || '暂无讲解';
        document.getElementById('ai-example').textContent = aiTutor.exampleSentence || '暂无例句';
        document.getElementById('ai-tips').textContent = aiTutor.extraTips || '暂无提示';
    }

    /**
     * 显示复习卡片
     * @param {object} word - 包含复习词信息的对象
     */
    function showReviewWord(word) {
        showState('review-section');
        document.getElementById('review-word-spanish').textContent = word.spanish;
        document.getElementById('review-word-english').textContent = word.english;
        document.getElementById('review-word-english').style.visibility = 'hidden';
        showAnswerBtn.style.display = 'block';
        feedbackButtons.style.display = 'none';
    }


    // --- 核心逻辑 ---

    /**
     * 处理任务队列中的下一个任务
     */
    function processNextTask() {
        if (taskQueue.length > 0) {
            currentTask = taskQueue.shift();
            showReviewWord(currentTask);
        } else {
            showState('finished-state');
        }
    }

    /**
     * 从后端获取每日学习任务
     */
    async function fetchDailyTask() {
        showState('loading-state');
        try {
            const response = await fetch('/api/getDailyTask');
            if (!response.ok) throw new Error('Network response was not ok.');
            
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
            console.error('Fetch error:', error);
            showState('error-state');
        }
    }

    /**
     * 更新单词学习进度到后端
     * @param {string} word - 西班牙语单词
     * @param {number} quality - 回答质量 (3, 4, 5)
     */
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

    // 点击 "我学会了，开始复习!"
    markAsLearnedBtn.addEventListener('click', async () => {
        await updateProgress(currentTask.newWord.spanish, 5); // 首次学习默认为"记住了"
        processNextTask();
    });

    // 点击 "显示答案"
    showAnswerBtn.addEventListener('click', () => {
        document.getElementById('review-word-english').style.visibility = 'visible';
        showAnswerBtn.style.display = 'none';
        feedbackButtons.style.display = 'flex';
    });

    // 点击 "忘记了" "有点难" "记住了"
    feedbackButtons.addEventListener('click', async (e) => {
        if (e.target.classList.contains('feedback-btn')) {
            const quality = parseInt(e.target.dataset.quality, 10);
            await updateProgress(currentTask.spanish, quality);
            processNextTask();
        }
    });
    
    // 点击朗读按钮
    speakButton.addEventListener('click', () => {
        if (!currentTask || !currentTask.newWord) return;

        const word = currentTask.newWord.spanish;
        const sentence = currentTask.newWord.aiTutor.exampleSentence;

        if (word && sentence) {
            // 先读单词，读完后再读例句
            speak(word, 'es-ES', () => {
                setTimeout(() => {
                    speak(sentence, 'es-ES');
                }, 300); // 短暂延迟，使发音更自然
            });
        } else if (word) {
            speak(word, 'es-ES');
        }
    });

    // --- 应用启动 ---
    fetchDailyTask();
});

