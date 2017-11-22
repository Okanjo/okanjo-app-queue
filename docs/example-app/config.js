"use strict";

// Ordinarily, you would set normally and not use environment variables,
// but this is for ease of running the example across platforms
const host = process.env.RABBIT_HOST || '192.168.99.100';
const port = process.env.RABBIT_PORT || 5672;
const login = process.env.RABBIT_USER || 'test';
const password = process.env.RABBIT_PASS || 'test';
const vhost = process.env.RABBIT_VHOST || 'test';

module.exports = {
    rabbit: {
        host,
        port,

        login,
        password,

        vhost,

        // What exchanges/queues to setup (they'll be configured to use the same name)
        queues: {
            events: "my_events",
            batch: "my_batches"
        },

        // Handle connection drop scenarios
        reconnect: true,
        reconnectBackoffStrategy: 'linear',
        reconnectBackoffTime: 1000,
        reconnectExponentialLimit: 5000 // don't increase over 5s to reconnect
    }
};