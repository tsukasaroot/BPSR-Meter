// Global variables
let socket = null;
let isWebSocketConnected = false;
let apiInterval = null;
let isPaused = false;
let currentSortMode = 'hp';
let currentPlayers = [];
let playerCards = []; // Pre-generated card array
const MAX_CARDS = 20; // Maximum number of cards

// Profession mapping
const professionMap = {
    雷影剑士: { type: 'damage', color: '#e74c3c', short_name: '太刀' },
    冰魔导师: { type: 'damage', color: '#e74c3c', short_name: '冰法' },
    青岚骑士: { type: 'damage', color: '#e74c3c', short_name: '长枪' },
    神射手: { type: 'damage', color: '#e74c3c', short_name: '弓箭' },
    '涤罪恶火·战斧': { type: 'damage', color: '#e74c3c', short_name: '战斧' },
    '雷霆一闪·手炮': { type: 'damage', color: '#e74c3c', short_name: '手炮' },
    '暗灵祈舞·仪刀/仪仗': { type: 'damage', color: '#e74c3c', short_name: '仪刀' },
    森语者: { type: 'heal', color: '#27ae60', short_name: '森语' },
    灵魂乐手: { type: 'heal', color: '#27ae60', short_name: '吉他' },
    巨刃守护者: { type: 'tank', color: '#2980b9', short_name: '巨刃' },
    神盾骑士: { type: 'tank', color: '#2980b9', short_name: '剑盾' },
};

// Initialize connection
function initConnection() {
    initWebSocket();
    monitorConnection();
}

// WebSocket connection
function initWebSocket() {
    try {
        socket = io();

        socket.on('connect', () => {
            console.log('WebSocket connection successful');
            isWebSocketConnected = true;
            stopAPIFallback();
            updateConnectionStatus('connected');
        });

        socket.on('data', (data) => {
            if (!isPaused && data && data.user) {
                processData(data.user);
            }
        });

        socket.on('disconnect', () => {
            console.log('WebSocket disconnected');
            isWebSocketConnected = false;
            updateConnectionStatus('disconnected');
        });

        socket.on('connect_error', (error) => {
            console.error('WebSocket connection error:', error);
            isWebSocketConnected = false;
            updateConnectionStatus('disconnected');
        });
    } catch (error) {
        console.error('WebSocket initialization failed:', error);
        startAPIFallback();
    }
}

// Monitor connection status
function monitorConnection() {
    setInterval(() => {
        if (!isWebSocketConnected && !apiInterval) {
            console.log('WebSocket disconnected, switching to API polling');
            startAPIFallback();
        }
    }, 3000);
}

// Start API fallback mode
function startAPIFallback() {
    if (apiInterval) return;

    console.log('Starting API polling mode');
    updateConnectionStatus('api');
    apiInterval = setInterval(fetchDataFromAPI, 100);
}

// Stop API fallback mode
function stopAPIFallback() {
    if (apiInterval) {
        clearInterval(apiInterval);
        apiInterval = null;
        console.log('Stopping API polling mode');
    }
}

// Fetch data from API
async function fetchDataFromAPI() {
    if (isPaused) return;

    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        if (data.code === 0 && data.user) {
            processData(data.user);
        }
    } catch (error) {
        console.error('API request failed:', error);
        updateConnectionStatus('disconnected');
    }
}

// Update connection status display
function updateConnectionStatus(status) {
    const statusElement = document.getElementById('connectionStatus');
    statusElement.className = `connection-status status-${status}`;

    switch (status) {
        case 'connected':
            statusElement.textContent = '🟢 WebSocket';
            break;
        case 'api':
            statusElement.textContent = '🟡 Polling Mode';
            break;
        case 'disconnected':
            statusElement.textContent = '🔴 Disconnected';
            break;
        default:
            statusElement.textContent = '🔄 Connecting';
    }
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

// Process data
function processData(users) {
    users = Object.entries(users)
        .map(([id, user]) => ({ ...user, id }))
        .filter((user) => !isUserInactive(user));
    if (!Array.isArray(users)) return;

    // Filter users with HP data, up to 20
    let validUsers = users.filter((user) => user.hp !== undefined && user.max_hp !== undefined && user.max_hp > 0).slice(0, 20);

    // Sort
    validUsers = sortPlayers(validUsers);

    currentPlayers = validUsers;
    updateUI();
}

// Sort players
function sortPlayers(players) {
    switch (currentSortMode) {
        case 'hp':
            return players.sort((a, b) => {
                const hpPercentA = (a.hp / a.max_hp) * 100;
                const hpPercentB = (b.hp / b.max_hp) * 100;
                return hpPercentA - hpPercentB; // Lower HP first
            });
        case 'name':
            return players.sort((a, b) => {
                const nameA = (a.name || `UID:${a.id}`).toLowerCase();
                const nameB = (b.name || `UID:${b.id}`).toLowerCase();
                return nameA.localeCompare(nameB);
            });
        case 'dps':
            return players.sort((a, b) => (b.total_dps || 0) - (a.total_dps || 0));
        case 'hps':
            return players.sort((a, b) => (b.total_hps || 0) - (a.total_hps || 0));
        default:
            return players;
    }
}

// Update UI
function updateUI() {
    updatePlayerCount();
    renderPlayerCards();
}

// Update player count display
function updatePlayerCount() {
    const playerCountElement = document.getElementById('playerCount');
    const count = currentPlayers.length;
    playerCountElement.textContent = `Monitoring: ${count}/20 players`;
}

// Render player cards
function renderPlayerCards() {
    const grid = document.getElementById('playerGrid');
    const noDataElement = grid.querySelector('.no-data');

    if (currentPlayers.length === 0) {
        // Hide all cards
        playerCards.forEach((card, index) => {
            setTimeout(() => {
                card.style.display = 'none';
            }, index * 20);
        });

        // Show no data message
        if (noDataElement) {
            setTimeout(
                () => {
                    noDataElement.style.display = 'block';
                },
                playerCards.length * 20 + 100,
            );
        }
        return;
    }

    // Hide no data message
    if (noDataElement) {
        noDataElement.style.display = 'none';
    }

    // Update existing card content and display
    currentPlayers.forEach((player, index) => {
        if (index < playerCards.length) {
            const card = playerCards[index];

            // If card is currently hidden, show it first then update content
            if (card.style.display === 'none') {
                card.style.display = 'flex';
                card.style.opacity = '0';
                card.style.transform = 'translateY(20px)';

                // Delayed display animation
                setTimeout(() => {
                    card.style.opacity = '1';
                    card.style.transform = 'translateY(0)';
                }, index * 50);
            }

            updatePlayerCard(card, player, index);
        }
    });

    // Hide extra cards
    for (let i = currentPlayers.length; i < playerCards.length; i++) {
        const card = playerCards[i];
        if (card.style.display !== 'none') {
            card.style.opacity = '0';
            card.style.transform = 'translateY(-10px)';

            setTimeout(() => {
                card.style.display = 'none';
            }, 200);
        }
    }
}

// Pre-generate player cards
function preGeneratePlayerCards() {
    const grid = document.getElementById('playerGrid');

    // Clear existing content
    grid.innerHTML = '';
    playerCards = [];

    // Create maximum number of cards
    for (let i = 0; i < MAX_CARDS; i++) {
        const card = createEmptyPlayerCard(i);
        playerCards.push(card);
        grid.appendChild(card);
    }

    // Add no data message element
    const noDataElement = document.createElement('div');
    noDataElement.className = 'no-data';
    noDataElement.innerHTML = '<div>📭 No HP data for participating players yet<br>🗺️ Switch lines or maps to re-acquire HP data</div>';
    noDataElement.style.display = 'block';
    grid.appendChild(noDataElement);
}

// Create empty player card
function createEmptyPlayerCard(index) {
    const div = document.createElement('div');
    div.className = 'player-card';
    div.style.animationDelay = `${index * 0.05}s`;
    div.style.display = 'none';
    div.style.opacity = '0';
    div.style.transform = 'translateY(20px)';

    div.innerHTML = `
        <div class="player-info">
            <div class="player-basic">
                <div class="player-name" title="">Waiting for data...</div>
                <div class="player-profession">-</div>
            </div>
            <div class="player-stats">
                <div class="stat-item" title="Total DPS">
                    <span class="stat-icon">⚔️</span>
                    <span class="stat-value">0</span>
                </div>
                <div class="stat-item" title="Total HPS">
                    <span class="stat-icon">🩹</span>
                    <span class="stat-value">0</span>
                </div>
                <div class="stat-item" title="Total Damage">
                    <span class="stat-icon">💥</span>
                    <span class="stat-value">0</span>
                </div>
                <div class="stat-item" title="Total Healing">
                    <span class="stat-icon">❤️</span>
                    <span class="stat-value">0</span>
                </div>
            </div>
        </div>
        <div class="hp-container">
            <div class="hp-bar">
                <div class="hp-fill" style="width: 0%"></div>
            </div>
            <div class="hp-text">
                <span class="hp-current">0</span>
                <span class="hp-percentage">0%</span>
                <span class="hp-max">0</span>
            </div>
        </div>
    `;

    return div;
}

// Update existing player card
function updatePlayerCard(cardElement, player, index) {
    const hp = player.hp || 0;
    const maxHp = player.max_hp || 1;
    const hpPercent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
    const name = player.name || `UID:${player.id}`;
    const profession = player.profession || 'Unknown';

    // Get profession info
    const professionParts = profession.split('-');
    const mainProfession = professionParts[0];
    const subProfession = professionParts[1] || '';
    const professionInfo = professionMap[mainProfession] || { type: 'unknown', color: '#9E9E9E' };

    // Determine HP status
    let hpClass = '';
    if (hpPercent <= 25) hpClass = 'hp-critical';
    else if (hpPercent <= 50) hpClass = 'hp-warning';
    else if (hpPercent >= 99) hpClass = 'hp-full';
    else hpClass = 'hp-healthy';

    // Update card class name and style
    cardElement.className = `player-card profession-${professionInfo.type} ${hpClass}`;
    cardElement.style.setProperty('--profession-color', professionInfo.color);

    // Update card content
    const playerNameEl = cardElement.querySelector('.player-name');
    const playerProfessionEl = cardElement.querySelector('.player-profession');
    const hpCurrentEl = cardElement.querySelector('.hp-current');
    const hpPercentageEl = cardElement.querySelector('.hp-percentage');
    const hpMaxEl = cardElement.querySelector('.hp-max');
    const hpFillEl = cardElement.querySelector('.hp-fill');
    const statValues = cardElement.querySelectorAll('.stat-value');

    playerNameEl.textContent = name;
    playerNameEl.title = name;

    playerProfessionEl.textContent = subProfession || professionInfo.short_name || 'Unknown';
    playerProfessionEl.style.backgroundColor = professionInfo.color;

    hpCurrentEl.textContent = hp;
    hpPercentageEl.textContent = `${hpPercent.toFixed(0)}%`;
    hpMaxEl.textContent = maxHp;
    hpFillEl.style.width = `${hpPercent}%`;

    // Update stats
    if (statValues.length >= 3) {
        statValues[0].textContent = formatNumber(player.total_dps || 0, 1);
        statValues[1].textContent = formatNumber(player.total_hps || 0, 1);
        statValues[2].textContent = formatNumber(player.total_damage?.total || 0);
        statValues[3].textContent = formatNumber(player.total_healing?.total || 0);
    }
}

// Format number
function formatNumber(num, decimals = 0) {
    if (num === undefined || num === null) return '0';

    const number = parseFloat(num);
    if (isNaN(number)) return '0';

    if (number >= 1000000) {
        return (number / 1000000).toFixed(decimals) + 'M';
    } else if (number >= 1000) {
        return (number / 1000).toFixed(decimals) + 'K';
    } else {
        return number.toFixed(decimals);
    }
}

// Set sort mode
function setSortMode(mode) {
    currentSortMode = mode;

    // Update button status
    document.querySelectorAll('.controls .btn').forEach((btn) => {
        btn.classList.remove('active');
    });
    const targetBtn = document.getElementById(`sort${mode.charAt(0).toUpperCase() + mode.slice(1)}Btn`);
    if (targetBtn) {
        targetBtn.classList.add('active');
    }

    // Re-sort and render
    if (currentPlayers.length > 0) {
        currentPlayers = sortPlayers(currentPlayers);
        renderPlayerCards();
    }
}

// Page initialization
document.addEventListener('DOMContentLoaded', () => {
    // Pre-generate player cards
    preGeneratePlayerCards();

    // Initialize connection
    initConnection();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        switch (e.key.toLowerCase()) {
            case '1':
                setSortMode('hp');
                break;
            case '2':
                setSortMode('name');
                break;
            case '3':
                setSortMode('dps');
                break;
            case '4':
                setSortMode('hps');
                break;
        }
    });
});
