const cap = require('cap');
const { Readable } = require('stream');
const PacketProcessor = require('../../algo/packet');
const findDefaultNetworkDevice = require('../../algo/netInterfaceUtil');

const Cap = cap.Cap;
const decoders = cap.decoders;
const PROTOCOL = decoders.PROTOCOL;

const FRAGMENT_TIMEOUT = 30000; // 30 segundos

class Sniffer {
    constructor(logger, userDataManager, clearDataOnServerChangeCallback) {
        this.logger = logger;
        this.userDataManager = userDataManager;
        this.clearDataOnServerChangeCallback = clearDataOnServerChangeCallback;

        this.current_server = '';
        this._data = Buffer.alloc(0);
        this.tcp_next_seq = -1;
        this.tcp_cache = new Map();
        this.tcp_last_time = 0;
        this.tcp_lock = new Lock(); // Reutiliza la clase Lock de dataManager si es necesario, o defínela aquí.
        this.fragmentIpCache = new Map();
        this.eth_queue = [];
        this.c = null;
        this.device = null;
        this.isPaused = false; // Estado de pausa del sniffer
    }

    async initialize(deviceNum) {
        const devices = cap.deviceList();
        let num = deviceNum;

        if (num === 'auto') {
            this.logger.info('Auto detecting default network interface...');
            const detectedDeviceNum = await findDefaultNetworkDevice(devices);
            if (detectedDeviceNum !== undefined) {
                num = detectedDeviceNum;
                this.logger.info(`Using network interface: ${num} - ${devices[num].description}`);
            } else {
                this.logger.warn('Default network interface not found!');
                num = undefined;
            }
        }

        if (num === undefined || !devices[num]) {
            throw new Error('Invalid network device selected or auto-detection failed.');
        }

        this.device = devices[num].name;
        const filter = 'ip and tcp';
        const bufSize = 10 * 1024 * 1024;
        const buffer = Buffer.alloc(65535);

        this.c = new Cap();
        const linkType = this.c.open(this.device, filter, bufSize, buffer);
        if (linkType !== 'ETHERNET') {
            this.logger.error('The device seems to be WRONG! Please check the device! Device type: ' + linkType);
            throw new Error('Invalid device type: ' + linkType);
        }
        this.c.setMinBytes && this.c.setMinBytes(0);
        this.c.on('packet', (nbytes, trunc) => {
            if (!this.isPaused) {
                this.eth_queue.push(Buffer.from(buffer.subarray(0, nbytes)));
            }
        });

        this.logger.info('Packet sniffer initialized.');
        this.startProcessingLoop();
        this.startCleanupInterval();
    }

    setPaused(paused) {
        this.isPaused = paused;
    }

    clearTcpCache() {
        this._data = Buffer.alloc(0);
        this.tcp_next_seq = -1;
        this.tcp_last_time = 0;
        this.tcp_cache.clear();
    }

    getTCPPacket(frameBuffer, ethOffset) {
        const ipPacket = decoders.IPV4(frameBuffer, ethOffset);
        const ipId = ipPacket.info.id;
        const isFragment = (ipPacket.info.flags & 0x1) !== 0;
        const _key = `${ipId}-${ipPacket.info.srcaddr}-${ipPacket.info.dstaddr}-${ipPacket.info.protocol}`;
        const now = Date.now();

        if (isFragment || ipPacket.info.fragoffset > 0) {
            if (!this.fragmentIpCache.has(_key)) {
                this.fragmentIpCache.set(_key, {
                    fragments: [],
                    timestamp: now,
                });
            }

            const cacheEntry = this.fragmentIpCache.get(_key);
            const ipBuffer = Buffer.from(frameBuffer.subarray(ethOffset));
            cacheEntry.fragments.push(ipBuffer);
            cacheEntry.timestamp = now;

            if (isFragment) {
                return null;
            }

            const fragments = cacheEntry.fragments;
            if (!fragments) {
                this.logger.error(`Can't find fragments for ${_key}`);
                return null;
            }

            let totalLength = 0;
            const fragmentData = [];

            for (const buffer of fragments) {
                const ip = decoders.IPV4(buffer);
                const fragmentOffset = ip.info.fragoffset * 8;
                const payloadLength = ip.info.totallen - ip.hdrlen;
                const payload = Buffer.from(buffer.subarray(ip.offset, ip.offset + payloadLength));

                fragmentData.push({
                    offset: fragmentOffset,
                    payload: payload,
                });

                const endOffset = fragmentOffset + payloadLength;
                if (endOffset > totalLength) {
                    totalLength = endOffset;
                }
            }

            const fullPayload = Buffer.alloc(totalLength);
            for (const fragment of fragmentData) {
                fragment.payload.copy(fullPayload, fragment.offset);
            }

            this.fragmentIpCache.delete(_key);
            return fullPayload;
        }

        return Buffer.from(frameBuffer.subarray(ipPacket.offset, ipPacket.offset + (ipPacket.info.totallen - ipPacket.hdrlen)));
    }

    async processEthPacket(frameBuffer) {
        const ethPacket = decoders.Ethernet(frameBuffer);

        if (ethPacket.info.type !== PROTOCOL.ETHERNET.IPV4) return;

        const ipPacket = decoders.IPV4(frameBuffer, ethPacket.offset);
        const srcaddr = ipPacket.info.srcaddr;
        const dstaddr = ipPacket.info.dstaddr;

        const tcpBuffer = this.getTCPPacket(frameBuffer, ethPacket.offset);
        if (tcpBuffer === null) return;
        const tcpPacket = decoders.TCP(tcpBuffer);

        const buf = Buffer.from(tcpBuffer.subarray(tcpPacket.hdrlen));

        const srcport = tcpPacket.info.srcport;
        const dstport = tcpPacket.info.dstport;
        const src_server = srcaddr + ':' + srcport + ' -> ' + dstaddr + ':' + dstport;

        await this.tcp_lock.acquire();
        try {
            if (this.current_server !== src_server) {
                // Try to identify server via small packets
                if (buf[4] == 0) {
                    const data = buf.subarray(10);
                    if (data.length) {
                        const stream = Readable.from(data, { objectMode: false });
                        let data1;
                        do {
                            const len_buf = stream.read(4);
                            if (!len_buf) break;
                            const packetLength = len_buf.readUInt32BE();
                            // Añadir validación para la longitud del paquete
                            if (packetLength <= 4 || packetLength > 0x0fffff) {
                                // Si la longitud no es válida, dejamos de procesar este stream.
                                break;
                            }
                            data1 = stream.read(packetLength - 4);
                            const signature = Buffer.from([0x00, 0x63, 0x33, 0x53, 0x42, 0x00]); //c3SB??
                            if (data1 && data1.length && Buffer.compare(data1.subarray(5, 5 + signature.length), signature) === 0) {
                                if (this.current_server !== src_server) {
                                    this.current_server = src_server;
                                    this.clearTcpCache();
                                    this.tcp_next_seq = tcpPacket.info.seqno + buf.length;
                                    this.clearDataOnServerChangeCallback();
                                    this.logger.info('Got Scene Server Address: ' + src_server);
                                }
                            }
                        } while (data1 && data1.length);
                    }
                }
                // Try to identify server via login return packet (still needs testing)
                if (buf.length === 0x62) {
                    // prettier-ignore
                    const signature = Buffer.from([
                        0x00, 0x00, 0x00, 0x62,
                        0x00, 0x03,
                        0x00, 0x00, 0x00, 0x01,
                        0x00, 0x11, 0x45, 0x14,//seq?
                        0x00, 0x00, 0x00, 0x00,
                        0x0a, 0x4e, 0x08, 0x01, 0x22, 0x24
                    ]);
                    if (
                        Buffer.compare(buf.subarray(0, 10), signature.subarray(0, 10)) === 0 &&
                        Buffer.compare(buf.subarray(14, 14 + 6), signature.subarray(14, 14 + 6)) === 0
                    ) {
                        if (this.current_server !== src_server) {
                            this.current_server = src_server;
                            this.clearTcpCache();
                            this.tcp_next_seq = tcpPacket.info.seqno + buf.length;
                            this.clearDataOnServerChangeCallback();
                            this.logger.info('Got Scene Server Address by Login Return Packet: ' + src_server);
                        }
                    }
                }
                return;
            }

            if (this.tcp_next_seq === -1) {
                this.logger.error('Unexpected TCP capture error! tcp_next_seq is -1');
                if (buf.length > 4 && buf.readUInt32BE() < 0x0fffff) {
                    this.tcp_next_seq = tcpPacket.info.seqno;
                }
            }

            if ((this.tcp_next_seq - tcpPacket.info.seqno) << 0 <= 0 || this.tcp_next_seq === -1) {
                this.tcp_cache.set(tcpPacket.info.seqno, buf);
            }

            while (this.tcp_cache.has(this.tcp_next_seq)) {
                const seq = this.tcp_next_seq;
                const cachedTcpData = this.tcp_cache.get(seq);
                this._data = this._data.length === 0 ? cachedTcpData : Buffer.concat([this._data, cachedTcpData]);
                this.tcp_next_seq = (seq + cachedTcpData.length) >>> 0; //uint32
                this.tcp_cache.delete(seq);
                this.tcp_last_time = Date.now();
            }

            while (this._data.length > 4) {
                let packetSize = this._data.readUInt32BE();

                if (this._data.length < packetSize) break;

                if (this._data.length >= packetSize) {
                    const packet = this._data.subarray(0, packetSize);
                    this._data = this._data.subarray(packetSize);
                    const processor = new PacketProcessor({ logger: this.logger, userDataManager: this.userDataManager });
                    processor.processPacket(packet);
                } else if (packetSize > 0x0fffff) {
                    this.logger.error(`Invalid Length!! ${this._data.length},${packetSize},${this._data.toString('hex')},${this.tcp_next_seq}`);
                    process.exit(1);
                    break;
                }
            }
        } finally {
            this.tcp_lock.release();
        }
    }

    async startProcessingLoop() {
        while (true) {
            if (this.eth_queue.length) {
                const pkt = this.eth_queue.shift();
                await this.processEthPacket(pkt);
            } else {
                await new Promise((r) => setTimeout(r, 1));
            }
        }
    }

    startCleanupInterval() {
        setInterval(() => {
            const now = Date.now();
            let clearedFragments = 0;
            for (const [key, cacheEntry] of this.fragmentIpCache) {
                if (now - cacheEntry.timestamp > FRAGMENT_TIMEOUT) {
                    this.fragmentIpCache.delete(key);
                    clearedFragments++;
                }
            }
            if (clearedFragments > 0) {
                this.logger.debug(`Cleared ${clearedFragments} expired IP fragment caches`);
            }

            if (this.tcp_last_time && Date.now() - this.tcp_last_time > FRAGMENT_TIMEOUT) {
                this.logger.warn('Cannot capture the next packet! Is the game closed or disconnected? seq: ' + this.tcp_next_seq);
                this.current_server = '';
                this.clearTcpCache();
            }
        }, 10000);
    }
}

// Reutiliza la clase Lock de dataManager o defínela aquí si es exclusiva de sniffer
class Lock {
    constructor() {
        this.queue = [];
        this.locked = false;
    }

    async acquire() {
        if (this.locked) {
            return new Promise((resolve) => this.queue.push(resolve));
        }
        this.locked = true;
    }

    release() {
        if (this.queue.length > 0) {
            const nextResolve = this.queue.shift();
            nextResolve();
        } else {
            this.locked = false;
        }
    }
}

module.exports = Sniffer;
