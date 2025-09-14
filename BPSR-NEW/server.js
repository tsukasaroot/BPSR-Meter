const winston = require('winston');
const zlib = require('zlib');
const readline = require('readline');
const { exec } = require('child_process');
const UserDataManager = require('./src/server/dataManager');
const Sniffer = require('./src/server/sniffer');
const ApiServer = require('./src/server/api');
const findDefaultNetworkDevice = require('./algo/netInterfaceUtil'); // Still needed for initial device selection

const VERSION = '3.1';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

function ask(question) {
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            resolve(answer);
        });
    });
}

async function main() {
    console.log('Welcome to use Damage Counter for Star Resonance!');
    console.log(`Version: V${VERSION}`);
    console.log('GitHub: https://github.com/dmlgzs/StarResonanceDamageCounter');

    const devices = require('cap').deviceList();
    for (let i = 0; i < devices.length; i++) {
        console.log(String(i).padStart(2, ' ') + '.' + (devices[i].description || devices[i].name));
    }

    const args = process.argv.slice(2);
    let num = args[0];
    let log_level = args[1];

    if (num === 'auto') {
        console.log('Auto detecting default network interface...');
        const device_num = await findDefaultNetworkDevice(devices);
        if (device_num !== undefined) {
            num = device_num;
            console.log(`Using network interface: ${num} - ${devices[num].description}`);
        } else {
            console.log('Default network interface not found!');
            num = undefined;
        }
    }

    function isValidLogLevel(level) {
        return ['info', 'debug'].includes(level);
    }

    while (num === undefined || !devices[num]) {
        num = await ask('Please enter the number of the device to capture: ');
        if (!num) {
            console.log('Auto detecting default network interface...');
            const device_num = await findDefaultNetworkDevice(devices);
            if (device_num !== undefined) {
                num = device_num;
                console.log(`Using network interface: ${num} - ${devices[num].description}`);
            } else {
                console.log('Default network interface not found!');
                num = undefined;
            }
        }
        if (!devices[num]) {
            console.log('Cannot find device ' + num + '!');
        }
    }
    while (log_level === undefined || !isValidLogLevel(log_level)) {
        log_level = (await ask('Please enter log level (info|debug): ')) || 'info';
        if (!isValidLogLevel(log_level)) {
            console.log('Invalid log level!');
        }
    }

    rl.close();

    const logger = winston.createLogger({
        level: log_level,
        format: winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf((info) => {
                return `[${info.timestamp}] [${info.level}] ${info.message}`;
            }),
        ),
        transports: [new winston.transports.Console()],
    });

    const userDataManager = new UserDataManager(logger);
    await userDataManager.initialize();

    const clearDataOnServerChange = () => {
        userDataManager.refreshEnemyCache();
        const globalSettings = userDataManager.getGlobalSettings();
        if (!globalSettings.autoClearOnServerChange || userDataManager.lastLogTime === 0 || userDataManager.users.size === 0) return;
        userDataManager.clearAll();
        logger.info('Server changed, statistics cleared!');
    };

    const sniffer = new Sniffer(logger, userDataManager, clearDataOnServerChange);
    await sniffer.initialize(num);

    const apiServer = new ApiServer(logger, userDataManager, sniffer);
    const serverPort = await apiServer.start();

    // Process exit handling
    process.on('SIGINT', async () => {
        console.log('\nSaving user cache...');
        await userDataManager.forceUserCacheSave();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\nSaving user cache...');
        await userDataManager.forceUserCacheSave();
        process.exit(0);
    });

    // Auto-open browser
    const url = 'http://localhost:' + serverPort;
    let command;
    switch (process.platform) {
        case 'darwin': // macOS
            command = `open ${url}`;
            break;
        case 'win32': // Windows
            command = `start ${url}`;
            break;
        default: // Linux and other Unix-like systems
            command = `xdg-open ${url}`;
            break;
    }

    exec(command, (error) => {
        if (error) {
            logger.error(`Failed to open browser: ${error.message}`);
        }
    });

    logger.info('Welcome!');
    logger.info('Attempting to find the game server, please wait!');
}

if (!zlib.zstdDecompressSync) {
    console.log('zstdDecompressSync is not available! Please update your Node.js!');
    process.exit(1);
}

main();
