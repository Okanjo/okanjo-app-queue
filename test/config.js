
// For unit testing, pull env config from env vars
const hostname = process.env.RABBIT_HOST || 'localhost';
const port = process.env.RABBIT_PORT || 5672;
const user = process.env.RABBIT_USER || 'guest';
const password = process.env.RABBIT_PASS || 'guest';
const vhost = process.env.RABBIT_VHOST || '/';

module.exports = {
    rabbit: {
        rascal: {
            vhosts: {
                [vhost]: {
                    connections: [
                        {
                            hostname,
                            user,
                            password,
                            port,
                            options: {
                                heartbeat: 1
                            },
                            socketOptions: {
                                timeout: 1000
                            }
                        }
                    ],
                    exchanges: [
                        "unittests"
                    ],
                    queues: {
                        "unittests": {}
                    },
                    bindings: {
                        // "unittests -> unittests": {}
                        "unittests": {
                            source: "unittests",
                            destination: "unittests",
                            destinationType: "queue",
                            bindingKey: "" // typically defaults to #, does this matter?
                        }
                    },
                    subscriptions: {
                        "unittests": {
                            queue: "unittests",
                            redeliveries: {
                                limit: 10,
                                counter: "shared"
                            },
                            deferCloseChannel: 5,
                        }
                    },
                    publications: {
                        "unittests": {
                            exchange: "unittests",
                            // routingKey: "something"
                        }
                    }
                }
            },
            // Define counter(s) for counting redeliveries
            redeliveries: {
                counters: {
                    shared: {
                        size: 10,
                        type: "inMemory"
                    }
                }
            }
        }
    }
};