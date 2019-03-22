"use strict";

const should = require('should');
const TestUtil = require('./TestUtil');

describe('QueueService', () => {

    const QueueService = require('../QueueService');
    const OkanjoApp = require('okanjo-app');
    const config = require('./config');

    /** @type {OkanjoApp} */
    let app;


    // Init
    before(async () => {

        // Create the app instance
        app = new OkanjoApp(config);

        // Add the redis service to the app
        app.services = {
            queue: new QueueService(app, config.rabbit)
        };

        await app.connectToServices();
    });

    it('should be bound to app', function () {
        app.services.queue.should.be.an.Object();
        app.services.queue.should.be.instanceof(QueueService);
    });

    it('should throw config errors if not setup', () => {
        const app2 = new OkanjoApp({});
        should(() => {
            new QueueService(app2);
        }).throw(/rascal/);
    });

    it('should throw if config is garbage', async () => {
        const app = new OkanjoApp({
            rabbit: {
                rascal: {
                    vhosts: {
                        "": {}
                    }
                }
            }
        });

        const service = new QueueService(app, app.config.rabbit);
        service.connect().should.be.rejectedWith(/vhost/)
    });

    describe('_handleBrokerError', () => {

        it('reports whatever it gets', () => {
            app.services.queue._handleBrokerError(new Error('Unit Testing'));
        });

    });

    describe('publishMessage', () => {

        let connection;
        const queue = "unittests";

        before(async () => {
            connection = await TestUtil.getConnection();
            await app.services.queue.broker.purge();
        });

        afterEach(async () => {
            await app.services.queue.broker.purge();
        });

        it('can publish a message', async () => {
            const payload = {num: 42, stuff: {things: [true]}};
            const pub = await app.services.queue.publishMessage(queue, payload);

            await new Promise((resolve) => {
                pub.on('success', (messageId) => {
                    should(messageId).be.ok();
                    resolve();
                });
            });

            const msg = await TestUtil.getMessage(connection, queue);
            JSON.parse(msg.content.toString()).should.be.deepEqual(payload);
        });

        it('can publish a message with callbacks', async () => {
            const payload = {num: 42, stuff: {things: [true]}};

            const pub = await new Promise((resolve, reject) => {
                app.services.queue.publishMessage(queue, payload, (err, pub) => {
                    if (err) return reject(err);
                    resolve(pub);
                });
            });

            await new Promise((resolve) => {
                pub.on('success', (messageId) => {
                    should(messageId).be.ok();
                    resolve();
                });
            });

            const msg = await TestUtil.getMessage(connection, queue);
            JSON.parse(msg.content.toString()).should.be.deepEqual(payload);
        });

        it('fails to send a message to a bogus queue', () => {
            return app.services.queue.publishMessage('bogus', {bogus: true}).should.be.rejectedWith(/bogus/);
        });

        it('fails to send a message to a bogus queue with a callback', (done) => {
            app.services.queue.publishMessage('bogus', {bogus: true}, (err, pub) => {
                should(err).be.ok();
                err.message.should.match(/bogus/);
                should(pub).not.be.ok();
                done();
            });
        });

    });

    describe('generateConfigFromQueueNames', () => {

        it('can generate basic queue-name-only configs', () => {

            const queues = ["apples", "bananas", "cherries"];
            const config = QueueService.generateConfigFromQueueNames(queues);

            config.should.deepEqual({
                exchanges: ['apples', 'bananas', 'cherries'],
                queues: {apples: {}, bananas: {}, cherries: {}},
                bindings: {
                    apples: {
                        source: 'apples',
                        destination: 'apples',
                        destinationType: 'queue',
                        bindingKey: ''
                    },
                    bananas: {
                        source: 'bananas',
                        destination: 'bananas',
                        destinationType: 'queue',
                        bindingKey: ''
                    },
                    cherries: {
                        source: 'cherries',
                        destination: 'cherries',
                        destinationType: 'queue',
                        bindingKey: ''
                    }
                },
                subscriptions: {
                    apples: {queue: 'apples'},
                    bananas: {queue: 'bananas'},
                    cherries: {queue: 'cherries'}
                },
                publications: {
                    apples: {exchange: 'apples'},
                    bananas: {exchange: 'bananas'},
                    cherries: {exchange: 'cherries'}
                }
            });

        });

        it('can generate basic queue-name-only configs with existing config', () => {

            const queues = ["apples", "bananas", "cherries"];
            const config = QueueService.generateConfigFromQueueNames(queues, {
                connections: [
                    {
                        hostname: "localhost",
                        user: "guest",
                        password: "guest",
                        port: 5672,
                        options: {
                            heartbeat: 1
                        },
                        socketOptions: {
                            timeout: 1000
                        }
                    }
                ]
            });

            config.should.deepEqual({
                connections: [
                    {
                        hostname: "localhost",
                        user: "guest",
                        password: "guest",
                        port: 5672,
                        options: {
                            heartbeat: 1
                        },
                        socketOptions: {
                            timeout: 1000
                        }
                    }
                ],
                exchanges: ['apples', 'bananas', 'cherries'],
                queues: {apples: {}, bananas: {}, cherries: {}},
                bindings: {
                    apples: {
                        source: 'apples',
                        destination: 'apples',
                        destinationType: 'queue',
                        bindingKey: ''
                    },
                    bananas: {
                        source: 'bananas',
                        destination: 'bananas',
                        destinationType: 'queue',
                        bindingKey: ''
                    },
                    cherries: {
                        source: 'cherries',
                        destination: 'cherries',
                        destinationType: 'queue',
                        bindingKey: ''
                    }
                },
                subscriptions: {
                    apples: {queue: 'apples'},
                    bananas: {queue: 'bananas'},
                    cherries: {queue: 'cherries'}
                },
                publications: {
                    apples: {exchange: 'apples'},
                    bananas: {exchange: 'bananas'},
                    cherries: {exchange: 'cherries'}
                }
            });

        });

    });
});