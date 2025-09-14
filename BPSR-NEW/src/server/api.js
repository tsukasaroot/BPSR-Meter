const express = require('express');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const fsPromises = require('fs').promises;

class ApiServer {
    constructor(logger, userDataManager, sniffer, serverPort = 8989) {
        this.logger = logger;
        this.userDataManager = userDataManager;
        this.sniffer = sniffer;
        this.app = express();
        this.server = null;
        this.io = null;
        this.serverPort = serverPort;
        this.isPaused = false; // Estado de pausa global

        this.setupExpressApp();
        this.setupWebSocket();
        this.startRealtimeUpdate();
    }

    setupExpressApp() {
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.static(path.join(__dirname, '../../public'))); // Servir archivos estáticos desde la carpeta public

        this.app.get('/api/data', (req, res) => {
            const userData = this.userDataManager.getAllUsersData();
            res.json({ code: 0, user: userData });
        });

        this.app.get('/api/enemies', (req, res) => {
            const enemiesData = this.userDataManager.getAllEnemiesData();
            res.json({ code: 0, enemy: enemiesData });
        });

        this.app.get('/api/clear', (req, res) => {
            this.userDataManager.clearAll();
            this.logger.info('Statistics have been cleared!');
            res.json({ code: 0, msg: 'Statistics have been cleared!' });
        });

        this.app.post('/api/pause', (req, res) => {
            const { paused } = req.body;
            this.isPaused = paused;
            this.sniffer.setPaused(paused); // Notificar al sniffer
            this.logger.info(`Statistics ${this.isPaused ? 'paused' : 'resumed'}!`);
            res.json({ code: 0, msg: `Statistics ${this.isPaused ? 'paused' : 'resumed'}!`, paused: this.isPaused });
        });

        this.app.get('/api/pause', (req, res) => {
            res.json({ code: 0, paused: this.isPaused });
        });

        this.app.get('/api/skill/:uid', async (req, res) => {
            const uid = parseInt(req.params.uid);
            const skillData = this.userDataManager.getUserSkillData(uid);

            if (!skillData) {
                return res.status(404).json({ code: 1, msg: 'User not found' });
            }
            res.json({ code: 0, data: skillData });
        });

        this.app.get('/api/history/:timestamp/summary', async (req, res) => {
            const { timestamp } = req.params;
            const historyFilePath = path.join('./logs', timestamp, 'summary.json');
            try {
                const data = await fsPromises.readFile(historyFilePath, 'utf8');
                const summaryData = JSON.parse(data);
                res.json({ code: 0, data: summaryData });
            } catch (error) {
                if (error.code === 'ENOENT') {
                    this.logger.warn('History summary file not found:', error);
                    res.status(404).json({ code: 1, msg: 'History summary file not found' });
                } else {
                    this.logger.error('Failed to read history summary file:', error);
                    res.status(500).json({ code: 1, msg: 'Failed to read history summary file' });
                }
            }
        });

        this.app.get('/api/history/:timestamp/data', async (req, res) => {
            const { timestamp } = req.params;
            const historyFilePath = path.join('./logs', timestamp, 'allUserData.json');
            try {
                const data = await fsPromises.readFile(historyFilePath, 'utf8');
                const userData = JSON.parse(data);
                res.json({ code: 0, user: userData });
            } catch (error) {
                if (error.code === 'ENOENT') {
                    this.logger.warn('History data file not found:', error);
                    res.status(404).json({ code: 1, msg: 'History data file not found' });
                } else {
                    this.logger.error('Failed to read history data file:', error);
                    res.status(500).json({ code: 1, msg: 'Failed to read history data file' });
                }
            }
        });

        this.app.get('/api/history/:timestamp/skill/:uid', async (req, res) => {
            const { timestamp, uid } = req.params;
            const historyFilePath = path.join('./logs', timestamp, 'users', `${uid}.json`);
            try {
                const data = await fsPromises.readFile(historyFilePath, 'utf8');
                const skillData = JSON.parse(data);
                res.json({ code: 0, data: skillData });
            } catch (error) {
                if (error.code === 'ENOENT') {
                    this.logger.warn('History skill file not found:', error);
                    res.status(404).json({ code: 1, msg: 'History skill file not found' });
                } else {
                    this.logger.error('Failed to read history skill file:', error);
                    res.status(500).json({ code: 1, msg: 'Failed to read history skill file' });
                }
            }
        });

        this.app.get('/api/history/:timestamp/download', async (req, res) => {
            const { timestamp } = req.params;
            const historyFilePath = path.join('./logs', timestamp, 'fight.log');
            res.download(historyFilePath, `fight_${timestamp}.log`);
        });

        this.app.get('/api/history/list', async (req, res) => {
            try {
                const data = (await fsPromises.readdir('./logs', { withFileTypes: true }))
                    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
                    .map((e) => e.name);
                res.json({ code: 0, data: data });
            } catch (error) {
                if (error.code === 'ENOENT') {
                    this.logger.warn('History path not found:', error);
                    res.status(404).json({ code: 1, msg: 'History path not found' });
                } else {
                    this.logger.error('Failed to load history path:', error);
                    res.status(500).json({ code: 1, msg: 'Failed to load history path' });
                }
            }
        });

        this.app.get('/api/settings', async (req, res) => {
            res.json({ code: 0, data: this.userDataManager.getGlobalSettings() });
        });

        this.app.post('/api/settings', async (req, res) => {
            const newSettings = req.body;
            await this.userDataManager.updateSettings(newSettings);
            res.json({ code: 0, data: this.userDataManager.getGlobalSettings() });
        });
    }

    setupWebSocket() {
        this.server = require('http').createServer(this.app);
        this.io = new Server(this.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST'],
            },
        });

        this.io.on('connection', (socket) => {
            this.logger.info('WebSocket client connected: ' + socket.id);
            socket.on('disconnect', () => {
                this.logger.info('WebSocket client disconnected: ' + socket.id);
            });
        });
    }

    startRealtimeUpdate() {
        // Instant DPS update
        setInterval(() => {
            if (!this.isPaused) {
                this.userDataManager.updateAllRealtimeDps();
            }
        }, 100);

        // Broadcast data to all WebSocket clients every 100ms
        setInterval(() => {
            if (!this.isPaused) {
                const userData = this.userDataManager.getAllUsersData();
                this.io.emit('data', { code: 0, user: userData });
            }
        }, 100);
    }

    async start() {
        const checkPort = (port) => {
            return new Promise((resolve) => {
                const net = require('net');
                const server = net.createServer();
                server.once('error', () => resolve(false));
                server.once('listening', () => {
                    server.close(() => resolve(true));
                });
                server.listen(port);
            });
        };

        while (true) {
            if (await checkPort(this.serverPort)) break;
            this.logger.warn(`port ${this.serverPort} is already in use`);
            this.serverPort++;
        }

        this.server.listen(this.serverPort, () => {
            this.logger.info(`Web Server started at http://localhost:${this.serverPort}`);
            this.logger.info('WebSocket Server started');
        });
        return this.serverPort;
    }
}

module.exports = ApiServer;
