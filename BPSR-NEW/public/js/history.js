let historyTimeStamp = 0;
let availableTimeStamps = [];
let currentSortMode = 'uid'; // Default sort by UID
let userNicknames = JSON.parse(localStorage.getItem('userNicknames') || '{}');

// Data group display control related variables
let currentDataGroup = 'damage';
let lastVisiableUserArray = [];

// Hide inactive characters related variables
let hideInactiveUsers = false;

// New skill analysis function
let skillChart1 = null;
let skillChart2 = null;
let currentSkillUserId = 0;

// Copy user data
function copyUserData(userId) {
    const user = getUserFromArray(userId);
    if (!user) {
        console.error('User data not found');
        return;
    }

    const hasValidName = user.name && user.name.trim() !== '';
    const nickname = userNicknames[userId] || (hasValidName ? user.name : '') || '';
    const copyText = `${nickname}#${userId} Damage:${user.total_damage.total} Healing:${user.total_healing.total} DPS:${user.total_dps.toFixed(2)} HPS:${user.total_hps.toFixed(2)}`;

    // Copy nickname to clipboard
    navigator.clipboard
        .writeText(copyText)
        .then(() => {
            // Show copy success message
            showCopySuccess();
        })
        .catch((err) => {
            console.error('Copy failed:', err);
            // Fallback: use traditional method to copy
            try {
                const textArea = document.createElement('textarea');
                textArea.value = copyText;
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                showCopySuccess();
            } catch (e) {
                console.error('Fallback copy also failed:', e);
            }
        });
}

// Show copy success message
function showCopySuccess() {
    // Create temporary toast element
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #4CAF50;
        color: white;
        padding: 10px 20px;
        border-radius: 4px;
        z-index: 10000;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        animation: slideIn 0.3s ease-out;
    `;
    toast.textContent = '✅ User data copied';
    document.body.appendChild(toast);

    // Remove toast after 3 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 3000);
}

// Show skill analysis modal
async function showSkillAnalysis(userId) {
    currentSkillUserId = userId;
    const modal = document.getElementById('skillModal');
    modal.style.display = 'block';

    // Get skill data
    await fetchSkillData(userId);
}

// Close skill modal
function closeSkillModal() {
    const modal = document.getElementById('skillModal');
    modal.style.display = 'none';

    // Destroy chart instances
    if (skillChart1) {
        skillChart1.dispose();
        skillChart1 = null;
    }
    if (skillChart2) {
        skillChart2.dispose();
        skillChart2 = null;
    }
}

// Fetch skill data
async function fetchSkillData(userId) {
    try {
        const response = await fetch(`/api/history/${historyTimeStamp}/skill/${userId}`);
        const data = await response.json();

        if (data.code === 0) {
            renderSkillData(data.data);
        } else {
            console.error('Failed to get skill data:', data.msg);
        }
    } catch (error) {
        console.error('Failed to get skill data:', error);
    }
}

// Render skill data
function renderSkillData(skillData) {
    const userInfo = getUserFromArray(skillData.uid);

    // Update user info
    document.getElementById('skillUserId').textContent = skillData.uid;
    document.getElementById('skillUserName').textContent = `${skillData.name || `UID:${skillData.uid}`} - Skill Analysis`;
    document.getElementById('skillUserNickname').textContent = skillData.name;
    document.getElementById('skillUserProfession').textContent = userInfo ? userInfo.profession || 'Unknown' : 'Unknown';
    document.getElementById('fightPoint').textContent = userInfo ? userInfo.fightPoint || 'Unknown' : 'Unknown';
    document.getElementById('maxHp').textContent = skillData.attr ? skillData.attr.max_hp || 'Unknown' : 'Unknown';
    document.getElementById('skillCount').textContent = Object.keys(skillData.skills).length;

    // Convert object to array and sort
    const skills = Object.entries(skillData.skills);
    const sortedSkills = skills.slice().sort(([, a], [, b]) => b.totalDamage - a.totalDamage);

    // Prepare three sets of data for charts
    const skillNames = []; // For displayName
    const damages = [];
    const critRates = [];
    const luckyRates = [];

    // Render table
    const tableBody = document.getElementById('skillTableBody');
    tableBody.innerHTML = '';

    // Render table + collect chart data
    sortedSkills.forEach(([skillId, skill]) => {
        const name = skill.displayName || skillId;

        // Fill table
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${name}</td>
            <td>${skill.type}</td>
            <td>${skill.elementype}</td>
            <td>${skill.totalDamage.toLocaleString()}</td>
            <td>${skill.totalCount}</td>
            <td class="skill-crit">${(skill.critRate * 100).toFixed(2)}%</td>
            <td class="skill-lucky">${(skill.luckyRate * 100).toFixed(2)}%</td>
            <td>${(skill.damageBreakdown.critical + skill.damageBreakdown.crit_lucky).toLocaleString()}</td>
            <td>${(skill.damageBreakdown.normal + skill.damageBreakdown.lucky).toLocaleString()}</td>
        `;
        tableBody.appendChild(row);

        // Collect data for charts
        skillNames.push(name);
        damages.push(skill.totalDamage);
        critRates.push(skill.critRate * 100);
        luckyRates.push(skill.luckyRate * 100);
    });

    renderSkillCharts(skillNames, damages, critRates, luckyRates);
}

// Render skill charts
function renderSkillCharts(skillIds, damages, critRates, luckyRates) {
    const topNames = skillIds.slice(0, 5);
    const topDamages = damages.slice(0, 5);
    const topAllDamages = topDamages.reduce((a, b) => a + b, 0);
    const allDamages = damages.reduce((a, b) => a + b, 0);
    const otherDamages = allDamages - topAllDamages;

    // Construct data for top 5, and display labels
    const pieData = topNames.map((name, idx) => ({
        value: topDamages[idx],
        name: name,
        label: {
            show: true, // Show label for this item
            position: 'outside', // Outside the sector
            formatter: '{b}\n{d}%', // Display "Name + Percentage"
        },
        labelLine: {
            show: true, // Show guide line
        },
    }));
    pieData.push({
        value: otherDamages,
        name: 'Others',
        label: {
            show: true, // Show label for this item
            position: 'outside', // Outside the sector
            formatter: '{b}\n{d}%', // Display "Name + Percentage"
        },
        labelLine: {
            show: true, // Show guide line
        },
    });

    // Destroy existing charts
    if (skillChart1) skillChart1.dispose();
    if (skillChart2) skillChart2.dispose();

    // Create new chart instances
    skillChart1 = echarts.init(document.getElementById('skillDamageChart'));
    skillChart2 = echarts.init(document.getElementById('skillCritChart'));

    // Skill value distribution chart
    const damageOption = {
        title: {
            text: 'Skill Value Distribution',
            left: 'center',
            textStyle: { color: '#e2e8f0' },
        },
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c} ({d}%)',
            backgroundColor: 'rgba(40, 40, 60, 0.9)',
            borderColor: '#3498db',
            textStyle: { color: '#ecf0f1' },
        },
        legend: {
            orient: 'vertical',
            right: 10,
            top: 'center',
            textStyle: { color: '#cbd5e0' },
        },
        series: [
            {
                name: 'Skill Values',
                type: 'pie',
                radius: ['40%', '70%'],
                avoidLabelOverlap: false,
                itemStyle: {
                    borderRadius: 10,
                    borderColor: '#1a2a6c',
                    borderWidth: 2,
                },
                label: {
                    show: false,
                    position: 'center',
                },
                emphasis: {
                    label: {
                        show: true,
                        fontSize: '16',
                        fontWeight: 'bold',
                        color: '#e2e8f0',
                    },
                },
                labelLine: {
                    show: false,
                },
                data: pieData,
            },
        ],
    };

    // Crit rate/lucky trigger rate comparison chart
    const critOption = {
        title: {
            text: 'Crit Rate and Lucky Rate',
            left: 'center',
            textStyle: { color: '#e2e8f0' },
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            backgroundColor: 'rgba(40, 40, 60, 0.9)',
            borderColor: '#3498db',
            textStyle: { color: '#ecf0f1' },
        },
        legend: {
            data: ['Crit Rate', 'Lucky Rate'],
            bottom: 10,
            textStyle: { color: '#cbd5e0' },
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '15%',
            top: '15%',
            containLabel: true,
        },
        xAxis: {
            type: 'category',
            data: skillIds.map((id) => `${id}`), // Chart skill names
            axisLine: { lineStyle: { color: '#7f8c8d' } },
            axisLabel: {
                color: '#95a5a6',
                interval: 0,
                rotate: 45,
            },
        },
        yAxis: {
            type: 'value',
            name: 'Percentage',
            min: 0,
            max: 100,
            axisLine: { lineStyle: { color: '#7f8c8d' } },
            axisLabel: { color: '#95a5a6' },
            splitLine: { lineStyle: { color: 'rgba(127, 140, 141, 0.2)' } },
        },
        series: [
            {
                name: 'Crit Rate',
                type: 'bar',
                data: critRates,
                itemStyle: { color: '#ff9966' },
            },
            {
                name: 'Lucky Rate',
                type: 'bar',
                data: luckyRates,
                itemStyle: { color: '#93f9b9' },
            },
        ],
    };

    skillChart1.setOption(damageOption);
    skillChart2.setOption(critOption);

    // Respond to window resize
    window.addEventListener('resize', function () {
        skillChart1.resize();
        skillChart2.resize();
    });
}

// Helper function to get user data from array
function getUserFromArray(userId) {
    return currentUserArray.find((user) => user.id.toString() === userId.toString());
}

// Check if character is inactive
function isUserInactive(user) {
    // Check if total damage, total DPS, total HPS are all 0
    const totalDamage = user.total_damage?.total || 0;
    const totalDps = user.total_dps || 0;
    const totalHps = user.total_hps || 0;

    // Check if crit rate and lucky rate are NaN
    const critRate = user.total_count?.critical / user.total_count?.total;
    const luckyRate = user.total_count?.lucky / user.total_count?.total;

    return (totalDamage === 0 && totalDps === 0 && totalHps === 0) || (isNaN(critRate) && isNaN(luckyRate));
}

// Toggle hide inactive characters function
function toggleHideInactiveUsers() {
    hideInactiveUsers = !hideInactiveUsers;
    const btn = document.getElementById('hideInactiveBtn');
    if (hideInactiveUsers) {
        btn.classList.add('active');
        btn.innerHTML = '👀 Hidden Inactive';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '👀 Hide Inactive';
    }

    // Re-process current data
    if (currentUserArray && currentUserArray.length > 0) {
        sortUserArray(currentUserArray);
        let visibleUserArray = currentUserArray;

        // If hide inactive characters is enabled, further filter
        if (hideInactiveUsers) {
            visibleUserArray = visibleUserArray.filter((user) => !isUserInactive(user));
        }

        lastVisiableUserArray = visibleUserArray;
        updateTables(visibleUserArray);
    }
}

// Process data update (WebSocket and API common)
function processDataUpdate(data, updateHistory = true) {
    try {
        // Convert data to array for sorting
        const userArray = Object.keys(data.user).map((id) => ({
            id: Number(id),
            ...data.user[id],
        }));

        // Cache current user array
        currentUserArray = userArray;

        // Sort according to current sort mode
        sortUserArray(userArray);

        let visibleUserArray = userArray;

        // If hide inactive characters is enabled, further filter
        if (hideInactiveUsers) {
            visibleUserArray = visibleUserArray.filter((user) => !isUserInactive(user));
        }

        lastVisiableUserArray = visibleUserArray;
        updateTables(visibleUserArray);
    } catch (err) {
        console.error('Failed to process data update:', err);
    }
}

// Generate table rows
function updateTables(visibleUserArray) {
    const damageTable = document.getElementById('damageTable').querySelector('tbody');
    // Get all rows in damageTable
    let existingRows = damageTable.querySelectorAll('tr');
    if (existingRows.length > visibleUserArray.length) {
        // Remove extra rows
        for (let i = existingRows.length - 1; i >= visibleUserArray.length; i--) {
            damageTable.removeChild(existingRows[i]);
        }
    }
    if (existingRows.length < visibleUserArray.length) {
        // Add new rows
        for (let i = existingRows.length; i < visibleUserArray.length; i++) {
            const row = document.createElement('tr');
            damageTable.appendChild(row);
        }
    }
    existingRows = damageTable.querySelectorAll('tr');

    for (let i = 0; i < visibleUserArray.length; i++) {
        const user = visibleUserArray[i];
        const crit_rate = user.total_count.critical / user.total_count.total;
        const lucky_rate = user.total_count.lucky / user.total_count.total;

        const row = existingRows[i];

        const isSimpleMode = document.body.classList.contains('simple-mode');

        // Other data columns
        const otherCells = [
            user.profession || 'Unknown',
            Number(user.fightPoint).toLocaleString(),
            (user.hp ?? 'Unknown').toLocaleString(),
            Number(user.taken_damage).toLocaleString(),
            user.dead_count ?? 'Unknown',
            `${(crit_rate * 100).toFixed(2)}%`,
            `${(lucky_rate * 100).toFixed(2)}%`,
        ];
        if (currentDataGroup === 'damage' || currentDataGroup === 'all') {
            otherCells.push(Number(user.total_damage.total).toLocaleString());
            if (!isSimpleMode) {
                otherCells.push(
                    Number(user.total_damage.critical).toLocaleString(),
                    Number(user.total_damage.lucky).toLocaleString(),
                    Number(user.total_damage.crit_lucky).toLocaleString(),
                );
            }
            otherCells.push(
                Number(user.realtime_dps).toLocaleString(),
                Number(user.realtime_dps_max).toLocaleString(),
                Number(user.total_dps.toFixed(2)).toLocaleString(),
            );
        }
        if (currentDataGroup === 'healing' || currentDataGroup === 'all') {
            otherCells.push(Number(user.total_healing.total).toLocaleString());
            if (!isSimpleMode) {
                otherCells.push(
                    Number(user.total_healing.critical).toLocaleString(),
                    Number(user.total_healing.lucky).toLocaleString(),
                    Number(user.total_healing.crit_lucky).toLocaleString(),
                );
            }
            otherCells.push(
                Number(user.realtime_hps).toLocaleString(),
                Number(user.realtime_hps_max).toLocaleString(),
                Number(user.total_hps.toFixed(2)).toLocaleString(),
            );
        }
        let existingCells = row.querySelectorAll('td');
        // Required number of columns to display
        const requiredColumnCount = 3 + otherCells.length;
        if (existingCells.length > requiredColumnCount) {
            // Remove extra cells
            for (let j = existingCells.length - 1; j >= requiredColumnCount; j--) {
                row.removeChild(existingCells[j]);
            }
        }
        if (existingCells.length < requiredColumnCount) {
            // Add new cells
            for (let j = existingCells.length; j < requiredColumnCount; j++) {
                const cell = document.createElement('td');
                row.appendChild(cell);
            }
        }
        existingCells = row.querySelectorAll('td');
        // Update cell content
        existingCells.forEach((cell, index) => {
            if (index < 2) return;
            if (otherCells[index - 2] !== undefined) {
                cell.textContent = otherCells[index - 2];
            }
        });

        // Character ID column
        const uidCell = existingCells[0];
        uidCell.textContent = `${user.id}`;

        // Character nickname column
        const nicknameCell = existingCells[1];
        // Check if user.name is a non-empty string
        const hasValidName = user.name && user.name.trim() !== '';
        const nickname = userNicknames[user.id] || (hasValidName ? user.name : '');

        nicknameCell.textContent = nickname;
        const operationCell = existingCells[existingCells.length - 1];
        if (operationCell.querySelector('.skill-btn')) {
            // If skill button already exists, only update user ID
            operationCell.querySelector('.skill-btn').setAttribute('data-user-id', user.id);
            operationCell.querySelector('.copy-btn').setAttribute('data-user-id', user.id);
        } else {
            operationCell.innerHTML = '';
            const operationDiv = document.createElement('div');
            operationDiv.className = 'operation-div';
            operationCell.appendChild(operationDiv);

            // Create copy button
            const copyButton = document.createElement('button');
            copyButton.className = 'copy-btn';
            copyButton.innerHTML = '<i class="icon">📋</i> Copy Data';
            copyButton.setAttribute('data-user-id', user.id);
            operationDiv.appendChild(copyButton);

            // Create skill button
            const skillButton = document.createElement('button');
            skillButton.className = 'skill-btn';
            skillButton.innerHTML = '<i class="icon">📊</i> Skill Analysis';
            skillButton.setAttribute('data-user-id', user.id);
            operationDiv.appendChild(skillButton);
        }
    }
    updateTableStickyHeader();
    // Apply column display settings
    if (typeof applyColumnVisibility === 'function') {
        applyColumnVisibility();
    }
}

async function fetchData() {
    try {
        if (historyTimeStamp === 0) throw new Error('invalid timestamp');
        const res = await fetch(`/api/history/${historyTimeStamp}/data`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        processDataUpdate(data);
        document.querySelector('.no-data').style.display = 'none';
    } catch (err) {
        console.error('Failed to get data:', err);
        document.querySelector('.no-data').style.display = 'block';
    }
}

async function fetchHistoryList() {
    try {
        const res = await fetch(`/api/history/list`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        for (const ts of data.data) {
            availableTimeStamps.push(await fetchHistorySummary(ts));
        }
        const select = document.getElementById('chooseTime');
        select.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = 0;
        opt.textContent = 'Please select time to get data';
        select.appendChild(opt);
        availableTimeStamps.forEach((item) => {
            const opt = document.createElement('option');
            opt.value = item.timestamp;
            opt.textContent = item.name;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('Failed to get history list:', err);
    }
}

async function fetchHistorySummary(timestamp) {
    try {
        const res = await fetch(`/api/history/${timestamp}/summary`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        console.log(data);
        return {
            timestamp: timestamp,
            name: `${data.data.userCount} people ${new Date(data.data.startTime).toLocaleString()} ➡ ${new Date(data.data.endTime).toLocaleString()}`,
        };
    } catch (err) {
        console.error('Failed to get history summary:', err);
    }
    return {
        timestamp: timestamp,
        name: new Date(Number(timestamp)).toLocaleString(),
    };
}

function sortUserArray(userArray) {
    switch (currentSortMode) {
        case 'damage':
            userArray.sort((a, b) => b.total_damage.total - a.total_damage.total);
            break;
        case 'uid':
            userArray.sort((a, b) => a.id - b.id);
            break;
        case 'dps':
            userArray.sort((a, b) => b.total_dps - a.total_dps);
            break;
        case 'realtimeDpsMax':
            userArray.sort((a, b) => b.realtime_dps_max - a.realtime_dps_max);
            break;
        case 'takenDamage':
            userArray.sort((a, b) => b.taken_damage - a.taken_damage);
            break;
        case 'healing':
            userArray.sort((a, b) => b.total_healing.total - a.total_healing.total);
            break;
        case 'hps':
            userArray.sort((a, b) => b.total_hps - a.total_hps);
            break;
        case 'realtimeHpsMax':
            userArray.sort((a, b) => b.realtime_hps_max - a.realtime_hps_max);
            break;
        case 'fightPoint':
            userArray.sort((a, b) => b.fightPoint - a.fightPoint);
            break;
        case 'hp_min':
            userArray.sort((a, b) => a.hp - b.hp);
            break;
        default:
            userArray.sort((a, b) => a.id - b.id);
            break;
    }
}

function updateSortMode() {
    const select = document.getElementById('sortSelect');
    currentSortMode = select.value;
    fetchData();
}

function updateTimeStamp() {
    const select = document.getElementById('chooseTime');
    historyTimeStamp = Number(select.value);
    fetchData();
}

// Check local storage for theme and sort preferences on page load
function initTheme() {
    const isDarkMode = localStorage.getItem('darkMode') === 'true';
    const body = document.body;

    if (isDarkMode) {
        body.classList.add('dark-mode');
    }
}

function initSortMode() {
    const savedSortMode = localStorage.getItem('sortMode');
    if (savedSortMode) {
        currentSortMode = savedSortMode;
        document.getElementById('sortSelect').value = savedSortMode;
    }
}

// Initialize data group display mode
function initDataGroup() {
    const savedDataGroup = localStorage.getItem('dataGroup') || 'damage';
    currentDataGroup = savedDataGroup;
    setDataGroup(savedDataGroup);
}

// Toggle data group display
function toggleDataGroup(group) {
    currentDataGroup = group;
    setDataGroup(group);
    updateTables(lastVisiableUserArray);
}

// Set data group display status
function setDataGroup(group) {
    const body = document.body;
    const damageBtn = document.getElementById('damageGroupBtn');
    const healingBtn = document.getElementById('healingGroupBtn');
    const allBtn = document.getElementById('allGroupBtn');

    body.classList.remove('hide-damage', 'hide-healing');
    [damageBtn, healingBtn, allBtn].forEach((btn) => {
        if (btn) btn.classList.remove('active');
    });

    switch (group) {
        case 'damage':
            body.classList.add('hide-healing');
            if (damageBtn) damageBtn.classList.add('active');
            break;
        case 'healing':
            body.classList.add('hide-damage');
            if (healingBtn) healingBtn.classList.add('active');
            break;
        case 'all':
            if (allBtn) allBtn.classList.add('active');
            break;
        default:
            // Default to damage & DPS
            body.classList.add('hide-healing');
            if (damageBtn) damageBtn.classList.add('active');
            break;
    }
}

// Close modal when clicking outside
window.onclick = function (event) {
    const columnModal = document.getElementById('columnSettingsModal');
    const skillModal = document.getElementById('skillModal');
    if (event.target === columnModal) {
        closeColumnSettings();
    } else if (event.target === skillModal) {
        closeSkillModal();
    }
};

// Column display settings related functions
let columnVisibility = {
    uid: true,
    nickname: true,
    job: true,
    score: true,
    hp: true,
    takenDamage: true,
    deadCount: true,
    critRate: true,
    luckyRate: true,
    totalDamage: true,
    pureCrit: true,
    pureLucky: true,
    critLucky: true,
    realtimeDps: true,
    realtimeDpsMax: true,
    dps: true,
    totalHealing: true,
    healingPureCrit: true,
    healingPureLucky: true,
    healingCritLucky: true,
    realtimeHps: true,
    realtimeHpsMax: true,
    hps: true,
    actions: true,
};

// Update checkbox status
function updateColumnCheckboxes() {
    Object.keys(columnVisibility).forEach((column) => {
        const checkbox = document.querySelector(`#col-${column}`);
        if (checkbox) {
            checkbox.checked = columnVisibility[column];
        }
    });
}

function downloadFightLog() {
    window.open(`/api/history/${historyTimeStamp}/download`);
}

// Open column settings modal
function openColumnSettings() {
    generateColumnSettingsContent();
    document.getElementById('columnSettingsModal').style.display = 'flex';
}

// Close column settings modal
function closeColumnSettings() {
    document.getElementById('columnSettingsModal').style.display = 'none';
}

// Dynamically generate column settings content
function generateColumnSettingsContent() {
    const modal = document.getElementById('columnSettingsModal');
    const content = modal.querySelector('.column-settings-content');

    // Clear existing content (keep title)
    const existingGroups = content.querySelectorAll('.column-group');
    existingGroups.forEach((group) => group.remove());

    const isSimpleMode = document.body.classList.contains('simple-mode');

    // Basic info group
    const baseGroup = createColumnGroup('🔰 Basic Information', [
        { id: 'uid', label: 'Character ID', column: 'uid' },
        { id: 'nickname', label: 'Character Nickname', column: 'nickname' },
        { id: 'job', label: 'Class', column: 'job' },
        { id: 'score', label: 'Score', column: 'score' },
        { id: 'hp', label: 'HP', column: 'hp' },
        { id: 'takenDamage', label: 'Damage Taken', column: 'takenDamage' },
        { id: 'deadCount', label: 'Deaths', column: 'deadCount' },
        { id: 'critRate', label: 'Crit Rate', column: 'critRate' },
        { id: 'luckyRate', label: 'Lucky Rate', column: 'luckyRate' },
    ]);
    content.appendChild(baseGroup);

    // Display corresponding column settings based on current data group
    if (currentDataGroup === 'damage' || currentDataGroup === 'all') {
        // Damage data group
        const damageOptions = [{ id: 'totalDamage', label: 'Total Damage', column: 'totalDamage' }];

        if (!isSimpleMode) {
            damageOptions.push(
                { id: 'pureCrit', label: 'Pure Crit', column: 'pureCrit' },
                { id: 'pureLucky', label: 'Pure Lucky', column: 'pureLucky' },
                { id: 'critLucky', label: 'Crit Lucky', column: 'critLucky' },
            );
        }

        const damageGroup = createColumnGroup('⚔️ Damage Data', damageOptions);
        content.appendChild(damageGroup);

        // DPS data group
        const dpsGroup = createColumnGroup('⚡ DPS Data', [
            { id: 'realtimeDps', label: 'Instant DPS', column: 'realtimeDps' },
            { id: 'realtimeDpsMax', label: 'Max Instant', column: 'realtimeDpsMax' },
            { id: 'dps', label: 'Total DPS', column: 'dps' },
        ]);
        content.appendChild(dpsGroup);
    }

    if (currentDataGroup === 'healing' || currentDataGroup === 'all') {
        // Healing data group
        const healingOptions = [{ id: 'totalHealing', label: 'Total Healing', column: 'totalHealing' }];

        if (!isSimpleMode) {
            healingOptions.push(
                { id: 'healingPureCrit', label: 'Pure Crit', column: 'healingPureCrit' },
                { id: 'healingPureLucky', label: 'Pure Lucky', column: 'healingPureLucky' },
                { id: 'healingCritLucky', label: 'Crit Lucky', column: 'healingCritLucky' },
            );
        }

        const healingGroup = createColumnGroup('❤️ Healing Data', healingOptions);
        content.appendChild(healingGroup);

        // HPS data group
        const hpsGroup = createColumnGroup('💚 HPS Data', [
            { id: 'realtimeHps', label: 'Instant HPS', column: 'realtimeHps' },
            { id: 'realtimeHpsMax', label: 'Max Instant', column: 'realtimeHpsMax' },
            { id: 'hps', label: 'Total HPS', column: 'hps' },
        ]);
        content.appendChild(hpsGroup);
    }

    // Other group
    const otherGroup = createColumnGroup('🔧 Others', [{ id: 'actions', label: 'Actions', column: 'actions' }]);
    content.appendChild(otherGroup);

    // Re-bind events
    initColumnSettings();
}

// Create column settings group
function createColumnGroup(title, options) {
    const group = document.createElement('div');
    group.className = 'column-group';

    const groupTitle = document.createElement('div');
    groupTitle.className = 'column-group-title';
    groupTitle.textContent = title;
    group.appendChild(groupTitle);

    const optionsContainer = document.createElement('div');
    optionsContainer.className = 'column-options';

    options.forEach((option) => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'column-option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `col-${option.id}`;
        checkbox.setAttribute('data-column', option.column);
        checkbox.checked = columnVisibility[option.column] || false;

        const label = document.createElement('label');
        label.setAttribute('for', `col-${option.id}`);
        label.textContent = option.label;

        optionDiv.appendChild(checkbox);
        optionDiv.appendChild(label);
        optionsContainer.appendChild(optionDiv);
    });

    group.appendChild(optionsContainer);
    return group;
}

// Apply column display settings
function applyColumnVisibility() {
    const table = document.getElementById('damageTable');
    if (!table) return;

    // Basic info columns (rowspan=2)
    const baseColumns = [
        { column: 'uid', selector: 'th[title="Identificador único del personaje"]' },
        { column: 'nickname', selector: 'th[title="Apodo del personaje/Apodo personalizado"]' },
        { column: 'job', selector: 'th[title="Clase del personaje"]' },
        { column: 'score', selector: 'th[title="Puntuación del personaje"]' },
        { column: 'hp', selector: 'th[title="HP del personaje"]' },
        { column: 'takenDamage', selector: 'th[title="Daño recibido por el personaje en combate"]' },
        { column: 'deadCount', selector: 'th[title="Número de muertes del personaje en combate"]' },
        {
            column: 'critRate',
            selector: 'th[title="Proporción de golpes críticos del personaje en combate respecto al total de golpes"]',
        },
        {
            column: 'luckyRate',
            selector: 'th[title="Proporción de golpes de suerte del personaje en combate respecto al total de golpes"]',
        },
    ];

    // Apply display/hide for basic columns
    baseColumns.forEach(({ column, selector }) => {
        const isVisible = columnVisibility[column];
        const headerCell = table.querySelector(selector);
        if (headerCell) {
            if (isVisible) {
                headerCell.style.removeProperty('display');
            } else {
                headerCell.style.setProperty('display', 'none', 'important');
            }
        }
    });

    // Damage related columns
    const damageColumns = [
        { column: 'totalDamage', selector: 'th[title="Daño total infligido por el personaje en combate"]' },
        { column: 'pureCrit', selector: 'th[title="Daño crítico no afortunado infligido por el personaje en combate"]' },
        { column: 'pureLucky', selector: 'th[title="Daño afortunado no crítico infligido por el personaje en combate"]' },
        { column: 'critLucky', selector: 'th[title="Daño crítico afortunado infligido por el personaje en combate"]' },
    ];

    damageColumns.forEach(({ column, selector }) => {
        const isVisible = columnVisibility[column];
        const headerCell = table.querySelector(selector);
        if (headerCell) {
            if (isVisible) {
                headerCell.style.removeProperty('display');
            } else {
                headerCell.style.setProperty('display', 'none', 'important');
            }
        }
    });

    // DPS related columns
    const dpsColumns = [
        { column: 'realtimeDps', selector: 'th[title="Daño infligido por el personaje en el último segundo de combate"]' },
        { column: 'realtimeDpsMax', selector: 'th[title="DPS instantáneo máximo del personaje en combate"]' },
        {
            column: 'dps',
            selector:
                'th[title="DPS total del personaje en combate (calculado usando el tiempo entre la primera y la última habilidad como tiempo de combate efectivo)"]',
        },
    ];

    dpsColumns.forEach(({ column, selector }) => {
        const isVisible = columnVisibility[column];
        const headerCell = table.querySelector(selector);
        if (headerCell) {
            if (isVisible) {
                headerCell.style.removeProperty('display');
            } else {
                headerCell.style.setProperty('display', 'none', 'important');
            }
        }
    });

    // Healing related columns
    const healingColumns = [
        { column: 'totalHealing', selector: 'th[title="Cantidad total de curación realizada por el personaje en combate"]' },
        {
            column: 'healingPureCrit',
            selector: 'th[title="Cantidad de curación crítica no afortunada realizada por el personaje en combate"]',
        },
        {
            column: 'healingPureLucky',
            selector: 'th[title="Cantidad de curación afortunada no crítica realizada por el personaje en combate"]',
        },
        {
            column: 'healingCritLucky',
            selector: 'th[title="Cantidad de curación crítica afortunada realizada por el personaje en combate"]',
        },
    ];

    healingColumns.forEach(({ column, selector }) => {
        const isVisible = columnVisibility[column];
        const headerCell = table.querySelector(selector);
        if (headerCell) {
            if (isVisible) {
                headerCell.style.removeProperty('display');
            } else {
                headerCell.style.setProperty('display', 'none', 'important');
            }
        }
    });

    // HPS related columns
    const hpsColumns = [
        {
            column: 'realtimeHps',
            selector: 'th[title="Cantidad de daño y curación realizada por el personaje en el último segundo de combate"]',
        },
        { column: 'realtimeHpsMax', selector: 'th[title="HPS instantáneo máximo del personaje en combate"]' },
        {
            column: 'hps',
            selector:
                'th[title="HPS total del personaje en combate (calculado usando el tiempo entre la primera y la última habilidad como tiempo de combate efectivo)"]',
        },
    ];

    hpsColumns.forEach(({ column, selector }) => {
        const isVisible = columnVisibility[column];
        const headerCell = table.querySelector(selector);
        if (headerCell) {
            if (isVisible) {
                headerCell.style.removeProperty('display');
            } else {
                headerCell.style.setProperty('display', 'none', 'important');
            }
        }
    });

    // Actions column
    const actionsHeader = table.querySelector('th:last-child');
    if (actionsHeader && actionsHeader.textContent.includes('Acciones')) {
        if (columnVisibility.actions) {
            actionsHeader.style.removeProperty('display');
        } else {
            actionsHeader.style.setProperty('display', 'none', 'important');
        }
    }

    // Apply display/hide for table body cells
    applyBodyColumnVisibility();

    // Update colspan
    updateColspan();
}

// Apply display/hide for table body cells
function applyBodyColumnVisibility() {
    const table = document.getElementById('damageTable');
    if (!table) return;

    // Get all table body rows
    const rows = table.querySelectorAll('tbody tr');

    rows.forEach((row) => {
        const cells = row.querySelectorAll('td');

        // Basic info columns (0-8)
        const baseCols = ['uid', 'nickname', 'job', 'score', 'hp', 'takenDamage', 'deadCount', 'critRate', 'luckyRate'];
        baseCols.forEach((col, index) => {
            if (cells[index]) {
                if (columnVisibility[col]) {
                    cells[index].style.removeProperty('display');
                } else {
                    cells[index].style.setProperty('display', 'none', 'important');
                }
            }
        });

        // Dynamic columns need to determine position based on current data group and simple mode
        let cellIndex = 9; // Start from 10th column

        // Handle damage related columns
        if (currentDataGroup === 'damage' || currentDataGroup === 'all') {
            // Total damage column
            if (cells[cellIndex]) {
                if (columnVisibility.totalDamage) {
                    cells[cellIndex].style.removeProperty('display');
                } else {
                    cells[cellIndex].style.setProperty('display', 'none', 'important');
                }
            }
            cellIndex++;

            // Detailed damage columns (non-simple mode)
            if (!document.body.classList.contains('simple-mode')) {
                const detailCols = ['pureCrit', 'pureLucky', 'critLucky'];
                detailCols.forEach((col) => {
                    if (cells[cellIndex]) {
                        if (columnVisibility[col]) {
                            cells[cellIndex].style.removeProperty('display');
                        } else {
                            cells[cellIndex].style.setProperty('display', 'none', 'important');
                        }
                    }
                    cellIndex++;
                });
            }

            // DPS columns
            const dpsCols = ['realtimeDps', 'realtimeDpsMax', 'dps'];
            dpsCols.forEach((col) => {
                if (cells[cellIndex]) {
                    if (columnVisibility[col]) {
                        cells[cellIndex].style.removeProperty('display');
                    } else {
                        cells[cellIndex].style.setProperty('display', 'none', 'important');
                    }
                }
                cellIndex++;
            });
        }

        // Handle healing related columns
        if (currentDataGroup === 'healing' || currentDataGroup === 'all') {
            // Total healing column
            if (cells[cellIndex]) {
                if (columnVisibility.totalHealing) {
                    cells[cellIndex].style.removeProperty('display');
                } else {
                    cells[cellIndex].style.setProperty('display', 'none', 'important');
                }
            }
            cellIndex++;

            // Detailed healing columns (non-simple mode)
            if (!document.body.classList.contains('simple-mode')) {
                const healingDetailCols = ['healingPureCrit', 'healingPureLucky', 'healingCritLucky'];
                healingDetailCols.forEach((col) => {
                    if (cells[cellIndex]) {
                        if (columnVisibility[col]) {
                            cells[cellIndex].style.removeProperty('display');
                        } else {
                            cells[cellIndex].style.setProperty('display', 'none', 'important');
                        }
                    }
                    cellIndex++;
                });
            }

            // HPS columns
            const hpsCols = ['realtimeHps', 'realtimeHpsMax', 'hps'];
            hpsCols.forEach((col) => {
                if (cells[cellIndex]) {
                    if (columnVisibility[col]) {
                        cells[cellIndex].style.removeProperty('display');
                    } else {
                        cells[cellIndex].style.setProperty('display', 'none', 'important');
                    }
                }
                cellIndex++;
            });
        }

        // Actions column (last column)
        const lastCell = cells[cells.length - 1];
        if (lastCell) {
            if (columnVisibility.actions) {
                lastCell.style.removeProperty('display');
            } else {
                lastCell.style.setProperty('display', 'none', 'important');
            }
        }
    });
}

// Update table header colspan
function updateColspan() {
    const table = document.getElementById('damageTable');
    if (!table) return;

    // Calculate visible column count for each group
    const damageMainVisible = ['totalDamage', 'pureCrit', 'pureLucky', 'critLucky'].filter((col) => columnVisibility[col]).length;
    const dpsVisible = ['realtimeDps', 'realtimeDpsMax', 'dps'].filter((col) => columnVisibility[col]).length;
    const healingMainVisible = ['totalHealing', 'healingPureCrit', 'healingPureLucky', 'healingCritLucky'].filter(
        (col) => columnVisibility[col],
    ).length;
    const hpsVisible = ['realtimeHps', 'realtimeHpsMax', 'hps'].filter((col) => columnVisibility[col]).length;

    // Update colspan
    const damageMainHeader = table.querySelector('.damage-main-col');
    const dpsHeader = table.querySelector('.dps-col');
    const healingMainHeader = table.querySelector('.healing-main-col');
    const hpsHeader = table.querySelector('.hps-col');

    if (damageMainHeader) {
        if (damageMainVisible > 0) {
            damageMainHeader.setAttribute('colspan', damageMainVisible);
            damageMainHeader.style.removeProperty('display');
        } else {
            damageMainHeader.style.setProperty('display', 'none', 'important');
        }
    }

    if (dpsHeader) {
        if (dpsVisible > 0) {
            dpsHeader.setAttribute('colspan', dpsVisible);
            dpsHeader.style.removeProperty('display');
        } else {
            dpsHeader.style.setProperty('display', 'none', 'important');
        }
    }

    if (healingMainHeader) {
        if (healingMainVisible > 0) {
            healingMainHeader.setAttribute('colspan', healingMainVisible);
            healingMainHeader.style.removeProperty('display');
        } else {
            healingMainHeader.style.setProperty('display', 'none', 'important');
        }
    }

    if (hpsHeader) {
        if (hpsVisible > 0) {
            hpsHeader.setAttribute('colspan', hpsVisible);
            hpsHeader.style.removeProperty('display');
        } else {
            hpsHeader.style.setProperty('display', 'none', 'important');
        }
    }
}

// Column settings checkbox change event
function initColumnSettings() {
    document.querySelectorAll('#columnSettingsModal input[type="checkbox"]').forEach((checkbox) => {
        checkbox.addEventListener('change', function () {
            const column = this.getAttribute('data-column');
            columnVisibility[column] = this.checked;
            applyColumnVisibility();
        });
    });
}

// Initialize column settings
document.addEventListener('DOMContentLoaded', function () {
    initColumnSettings();
});

// Keyboard ESC key to close modal
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        const skillModal = document.getElementById('skillModal');

        if (skillModal.style.display === 'block') {
            closeSkillModal();
        }
    }
});

// Initialize
function initialize() {
    initTheme();
    initSortMode();
    initDataGroup();

    fetchHistoryList();
    fetchData();

    // Add event delegation to handle skill button clicks
    const damageTable = document.getElementById('damageTable');
    if (damageTable) {
        damageTable.addEventListener('click', function (event) {
            // Handle skill button clicks
            if (event.target.classList.contains('skill-btn') || event.target.closest('.skill-btn')) {
                const button = event.target.classList.contains('skill-btn') ? event.target : event.target.closest('.skill-btn');
                const userId = button.getAttribute('data-user-id');
                if (userId) {
                    showSkillAnalysis(parseInt(userId));
                }
            }
            // Handle copy button clicks
            else if (event.target.classList.contains('copy-btn') || event.target.closest('.copy-btn')) {
                const button = event.target.classList.contains('copy-btn') ? event.target : event.target.closest('.copy-btn');
                const userId = button.getAttribute('data-user-id');
                if (userId) {
                    copyUserData(parseInt(userId));
                }
            }
        });
    }
}

// Wait for DOM to load before initializing
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

function updateTableStickyHeader() {
    const damageTable = document.getElementById('damageTable');
    const damageTableRows = damageTable.querySelectorAll('tr');
    damageTableRows.forEach((row) => {
        const top = row.offsetTop;
        row.style.setProperty('--th-top', `${top}px`);
    });
}
window.addEventListener('resize', updateTableStickyHeader);
document.addEventListener('DOMContentLoaded', updateTableStickyHeader);
