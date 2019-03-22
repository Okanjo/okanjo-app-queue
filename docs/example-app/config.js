"use strict";

// Ordinarily, you would set normally and not use environment variables,
// but this is for ease of running the example across platforms
const hostname = process.env.RABBIT_HOST || 'localhost';
const port = process.env.RABBIT_PORT || 5672;
const user = process.env.RABBIT_USER || 'guest';
const password = process.env.RABBIT_PASS || 'guest';
const vhost = process.env.RABBIT_VHOST || '/';

const queues = {
    events: "my_events",
    batch: "my_batches"
};

const generateConfigFromQueueNames = require('../../QueueService').generateConfigFromQueueNames;


module.exports = {
    rabbit: {
        rascal: {
            vhosts: {
                [vhost]: generateConfigFromQueueNames(Object.values(queues), {
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
                    ]
                })
            }
        },

        // What exchanges/queues to setup (they'll be configured to use the same name)
        queues,
    }
};