// 确保在整个文档加载完毕后执行我们的代码
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. 获取所有需要操作的HTML元素 ---
    // 状态容器
    const loadingState = document.getElementById('loading-state');
    const newWordState = document.getElementById('new-word-state');
    const reviewState = document.getElementById('review-state');
    const finishedState = document.getElementById('finished-state');
    const allStates = [loadingState, newWordState, reviewState, finishedState];

    // 新词部分元素
    const newWordSpanish = document.getElementById('new-word-spanish');
    const aiExplanation = document.getElementById('ai-explanation');
    const aiExample = document.getElementById('ai-example');
    const aiTip = document.getElementById('ai-tip');
    const newWordLearnedBtn = document.getElementById('new-word-learned-btn');

    // 复习部分元素
    const reviewCount = document.getElementById('review-count');
    const reviewWordSpanish = document.getElementById('review-word-spanish');
    const reviewWordEnglish = document.getElementById('review-word-english');
    const showAnswerBtn = document.getElementById('show-answer-btn');
    const feedbackButtons = document.getElementById('feedback-buttons');
    const reviewAnswer = document.getElementById('review-answer');

    // --- 2. 全局状态管理 ---
    // 用一个对象来存储从后端获取的学习任务
    let dailyTask = {
        newWord: null,
        reviewQueue: [],
        currentReviewIndex: -1
    };

    // --- 3. UI控制函数 ---
    // 函数：用于切换显示不同的状态卡片
    function showState(stateToShow) {
        allStates.forEach(state => {
            state.style.display = 'none';
        });
        stateToShow.style.display = 'block';
    }

    // 函数：用于显示下一个任务（新词或复习）
    function displayNextTask() {
        // 首先，检查是否有新词需要学习
        if (dailyTask.newWord) {
            displayNewWord(dailyTask.newWord);
            // 将 newWord 设置为 null，表示已经处理过，下次调用就不会再显示
            dailyTask.newWord = null; 
        } 
        // 其次，检查复习队列中是否还有单词
        else if (dailyTask.reviewQueue.length > 0) {
            displayReviewWord();
        } 
        // 如果都没有，说明全部任务完成
        else {
            showState(finishedState);
        }
    }

    // 函数：专门用于显示新词卡片
    function displayNewWord(wordData) {
        newWordSpanish.textContent = wordData.spanish;
        aiExplanation.textContent = wordData.aiTutor.explanation;
        aiExample.innerHTML = `<strong>例句:</strong> <em>${wordData.aiTutor.exampleSentence}</em>`;
        aiTip.innerHTML = `<strong>💡 提示:</strong> ${wordData.aiTutor.extraTips}`;
        showState(newWordState);
    }

    // 函数：专门用于显示复习卡片
    function displayReviewWord() {
        const word = dailyTask.reviewQueue[0]; // 总是取队列的第一个
        reviewWordSpanish.textContent = word.spanish;
        reviewWordEnglish.textContent = word.english;
        reviewCount.textContent = dailyTask.reviewQueue.length;

        // 重置复习卡片的状态
        reviewAnswer.style.display = 'none';
        feedbackButtons.style.display = 'none';
        showAnswerBtn.style.display = 'block';

        showState(reviewState);
    }
    
    // --- 4. API通信函数 ---
    // 函数：获取每日学习任务
    async function fetchDailyTask() {
        try {
            const response = await fetch('/api/getDailyTask');
            if (!response.ok) {
                throw new Error('网络请求失败');
            }
            const data = await response.json();

            // 将获取的数据存入全局状态
            dailyTask.newWord = data.newWord;
            dailyTask.reviewQueue = data.reviewQueue || [];

            // 开始显示第一个任务
            displayNextTask();

        } catch (error) {
            console.error('获取每日任务失败:', error);
            // 可以在页面上显示一个错误提示
            loadingState.innerHTML = '<p>加载任务失败，请刷新页面重试。</p>';
        }
    }

    // 函数：更新单词学习进度
    async function updateProgress(word, quality) {
        try {
            await fetch('/api/update-progress', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    spanish: word.spanish,
                    english: word.english,
                    quality: quality
                }),
            });
        } catch (error) {
            console.error('更新进度失败:', error);
        }
    }

    // --- 5. 事件监听器 ---
    // 当点击 "我学会了" 按钮
    newWordLearnedBtn.addEventListener('click', async () => {
        // 因为这是新词，我们用 "记住了" (quality=5) 的标准来更新它的进度
        // 这样它就会被加入到未来的复习计划中
        await updateProgress(dailyTask.newWord, 5); 
        displayNextTask(); // 显示下一个任务（可能是复习，也可能是完成）
    });

    // 当点击 "显示答案" 按钮
    showAnswerBtn.addEventListener('click', () => {
        reviewAnswer.style.display = 'block';
        feedbackButtons.style.display = 'flex';
        showAnswerBtn.style.display = 'none';
    });

    // 当点击反馈按钮 ("忘记了", "有点难", "记住了")
    feedbackButtons.addEventListener('click', async (event) => {
        // 利用事件委托，判断是否点击了带有 data-quality 属性的按钮
        if (event.target.classList.contains('button-feedback')) {
            const quality = parseInt(event.target.dataset.quality, 10);
            const currentWord = dailyTask.reviewQueue.shift(); // 从队列头部取出一个单词并处理

            // 将用户的反馈发送到后端
            await updateProgress(currentWord, quality);
            
            // 显示下一个任务
            displayNextTask();
        }
    });

    // --- 6. 应用启动 ---
    // 页面加载后，立即开始获取每日任务
    fetchDailyTask();
});
